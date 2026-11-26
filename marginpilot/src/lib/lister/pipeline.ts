import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getEbayClient, EbayRateLimitError } from "@/lib/ebay/client";
import { suggestCategory } from "@/lib/ebay/api";
import { getAdapter, SupplierError, type SupplierProduct } from "@/lib/suppliers";
import { rowToProduct } from "@/lib/suppliers/csv";
import type { BulkItemInput } from "./bulk-input";
import { makeSku, priceListing } from "./pricing";
import { loadListing, publishListing } from "./publish";
import { loadStoreRules } from "./store";
import { writeListing } from "./writer";

/**
 * One bulk item, end to end: supplier product → supplier_products → AI draft
 * (bulk tier) → category → price at the target margin (worst-case ad rate) →
 * guard → listings row → optional publish. Idempotent per item: a retry reuses
 * the listing already created for it (deterministic SKU from the item id).
 * EbayRateLimitError is re-thrown for the job to turn into RetryAfterError.
 */

export type BulkJobRow = {
  id: string;
  org_id: string;
  store_id: string;
  created_by: string | null;
  mode: "draft" | "publish";
  source: "links" | "csv";
  supplier_id: string | null;
  target_margin_pct: number | string | null;
};

type ItemRow = { id: string; job_id: string; org_id: string; input: BulkItemInput; listing_id: string | null; status: string; error: string | null };

export type ItemOutcome = { status: "done" | "failed"; error?: string };

const QTY_CAP = 10; // never list more than this from one supplier stock reading

async function setItem(id: string, patch: Record<string, unknown>) {
  await createAdminClient().from("bulk_job_items").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
}

async function markFirstBatch(userId: string | null) {
  if (!userId) return;
  const db = createAdminClient();
  const { data } = await db.from("profiles").select("onboarding").eq("id", userId).maybeSingle();
  const onboarding = (data?.onboarding as Record<string, unknown>) ?? {};
  if (onboarding.first_batch) return;
  await db.from("profiles").update({ onboarding: { ...onboarding, first_batch: true } }).eq("id", userId);
}

async function fetchProduct(job: BulkJobRow, input: BulkItemInput): Promise<{ product: SupplierProduct; supplierId: string }> {
  const db = createAdminClient();
  if (!job.supplier_id) throw new SupplierError("This batch has no supplier.", "unsupported");
  const { data: supplier } = await db
    .from("suppliers")
    .select("id, adapter, config, wholesale_attested")
    .eq("id", job.supplier_id)
    .eq("org_id", job.org_id)
    .maybeSingle();
  if (!supplier) throw new SupplierError("The supplier for this batch was deleted.", "not_found");
  if (!supplier.wholesale_attested) throw new SupplierError("Confirm the wholesale relationship for this supplier first.", "unsupported");
  if (input.kind === "csv") return { product: rowToProduct(input.row), supplierId: supplier.id };
  const adapter = getAdapter(supplier.adapter);
  return { product: await adapter.fetchProduct(input.ref, (supplier.config as Record<string, unknown>) ?? {}), supplierId: supplier.id };
}

export async function processBulkItem(job: BulkJobRow, itemId: string): Promise<ItemOutcome> {
  const db = createAdminClient();
  const { data: itemData } = await db.from("bulk_job_items").select("id, job_id, org_id, input, listing_id, status, error").eq("id", itemId).eq("job_id", job.id).maybeSingle();
  const item = itemData as ItemRow | null;
  if (!item) return { status: "failed", error: "Item not found" };
  if (item.status === "done") return { status: "done" };
  await setItem(item.id, { status: "running", error: null });

  try {
    let listingId = item.listing_id;
    let note: string | undefined;

    if (!listingId) {
      const { product, supplierId } = await fetchProduct(job, item.input);

      const { data: sp, error: spErr } = await db
        .from("supplier_products")
        .upsert(
          {
            org_id: job.org_id,
            supplier_id: supplierId,
            external_id: product.externalId,
            source_url: product.sourceUrl,
            title: product.title,
            cost: product.cost,
            shipping_cost: product.shippingCost,
            stock: product.stock,
            images: product.images,
            raw: product,
            last_checked_at: new Date().toISOString(),
          },
          { onConflict: "supplier_id,external_id" },
        )
        .select("id")
        .single();
      if (spErr || !sp) throw new Error(`Couldn't save the supplier product: ${spErr?.message ?? "unknown"}`);

      const ai = await writeListing({ orgId: job.org_id, userId: job.created_by, storeId: job.store_id, input: { product }, bulk: true });
      if (!ai.ok) throw new Error(ai.message);
      const draft = ai.draft;

      let categoryId: string | null = null;
      try {
        const c = await getEbayClient(job.store_id);
        categoryId = (await suggestCategory(c, draft.title))?.categoryId ?? null;
      } catch (e) {
        if (e instanceof EbayRateLimitError) throw e;
        // category can be picked at publish time
      }

      const rules = await loadStoreRules(job.store_id);
      const target = job.target_margin_pct !== null ? Number(job.target_margin_pct) : rules.minNetMarginPct;
      const cost = { supplierCost: product.cost, supplierShipping: product.shippingCost };
      const priced = priceListing(target, cost, rules);
      if (priced.price === null) throw new Error(priced.ok ? "Pricing failed" : priced.reasons.join(" "));

      const blocked = !priced.ok;
      const quantity = Math.max(0, Math.min(product.stock, QTY_CAP));
      if (quantity === 0) note = "Out of stock at the supplier, kept as a draft.";
      const { data: listing, error: lErr } = await db
        .from("listings")
        .upsert(
          {
            org_id: job.org_id,
            store_id: job.store_id,
            supplier_product_id: sp.id,
            sku: makeSku(item.id),
            category_id: categoryId,
            title: draft.title,
            description: draft.description,
            item_specifics: draft.itemSpecifics,
            images: product.images,
            price: priced.price,
            quantity,
            status: blocked ? "blocked_margin" : "draft",
            net_margin_pct: priced.guard?.breakdown.marginPct ?? null,
            ad_rate_pct: priced.adRatePct,
            margin_reasons: blocked ? priced.reasons : [],
            last_error: blocked ? priced.reasons.join(" ") : (note ?? null),
            vero_risk: draft.vero.risk,
            vero_flags: draft.vero.reasons,
          },
          { onConflict: "store_id,sku" },
        )
        .select("id")
        .single();
      if (lErr || !listing) throw new Error(`Couldn't save the listing: ${lErr?.message ?? "unknown"}`);
      listingId = listing.id as string;
      await setItem(item.id, { listing_id: listingId });
      await db.from("ai_requests").update({ draft_status: job.mode === "publish" ? "approved" : "draft" }).eq("id", ai.requestId);
      await markFirstBatch(job.created_by);
      if (blocked) return finish(item.id, "done", `Blocked by the margin guard: ${priced.reasons.join(" ")}`);
      if (draft.vero.risk === "high" && job.mode === "publish") {
        const msg = `Kept as a draft: possible VeRO issue (${draft.vero.brandsMentioned.join(", ") || "brand terms"}). Review before publishing.`;
        await db.from("listings").update({ last_error: msg }).eq("id", listingId);
        return finish(item.id, "done", msg);
      }
    }

    if (job.mode === "publish") {
      const l = await loadListing(listingId, job.org_id);
      if (!l) throw new Error("Listing disappeared");
      if (l.status === "active") return finish(item.id, "done");
      if (l.status === "blocked_margin") return finish(item.id, "done", l.last_error ?? "Blocked by the margin guard.");
      if (l.quantity <= 0) return finish(item.id, "done", note ?? "Out of stock at the supplier, kept as a draft.");
      const res = await publishListing(l, { type: "automation", userId: job.created_by });
      if (res.ok) return finish(item.id, "done");
      if (res.status === "error") return finish(item.id, "failed", res.message);
      return finish(item.id, "done", res.message);
    }
    return finish(item.id, "done", note);
  } catch (e) {
    if (e instanceof EbayRateLimitError) {
      await setItem(item.id, { status: "queued", error: "Waiting for eBay rate limit…" });
      throw e;
    }
    const message = e instanceof Error ? e.message : "Unknown error";
    return finish(item.id, "failed", message);
  }
}

async function finish(itemId: string, status: "done" | "failed", error?: string): Promise<ItemOutcome> {
  await setItem(itemId, { status, error: error?.slice(0, 1000) ?? null });
  return { status, error };
}

export async function finishJob(jobId: string, failedRun = false) {
  const db = createAdminClient();
  const { data } = await db.from("bulk_job_items").select("status").eq("job_id", jobId);
  const rows = (data ?? []) as { status: string }[];
  const succeeded = rows.filter((r) => r.status === "done").length;
  const failed = rows.filter((r) => r.status === "failed").length;
  if (failedRun) {
    await db.from("bulk_job_items").update({ status: "failed", error: "The batch stopped before this item ran." }).eq("job_id", jobId).in("status", ["queued", "running"]);
  }
  await db
    .from("bulk_jobs")
    .update({
      status: failedRun ? "failed" : "done",
      succeeded,
      failed: failedRun ? rows.length - succeeded : failed,
      finished_at: new Date().toISOString(),
    })
    .eq("id", jobId);
}
