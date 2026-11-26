import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getEbayClient } from "@/lib/ebay/client";
import { withdrawOffer } from "@/lib/ebay/api";
import { logActivity } from "@/lib/activity";
import { pickReplacement, selectCleanupCandidates, type ReplacementProduct } from "./cleanup";
import { safePriceForMargin } from "./pricing";
import { REPRICE_TARGET_OVER_FLOOR_PCT } from "./monitor";
import { ebayErrorMessage, guardRules, loadStoreRules, storeOrgId, updateAutomationState } from "./store";

/** Cleanup scan (src/jobs/cleanup.ts) and the seller's decisions (/app/cleanup). */

export async function cleanupStoreIds(): Promise<string[]> {
  const db = createAdminClient();
  const { data: rules } = await db.from("store_rules").select("store_id").not("cleanup_after_days", "is", null);
  const ids = (rules ?? []).map((r) => r.store_id as string);
  if (!ids.length) return [];
  const { data: stores } = await db
    .from("ebay_stores")
    .select("id, organizations!inner(plan)")
    .in("id", ids)
    .eq("status", "active")
    .neq("organizations.plan", "none");
  return (stores ?? []).map((s) => s.id as string);
}

export async function scanStoreForCleanup(storeId: string, now = new Date()): Promise<{ candidates: number }> {
  const orgId = await storeOrgId(storeId);
  if (!orgId) return { candidates: 0 };
  const rulesRow = await loadStoreRules(storeId);
  const days = rulesRow.cleanup_after_days;
  if (!days || days <= 0) return { candidates: 0 };
  const db = createAdminClient();

  const { data: listingRows } = await db
    .from("listings")
    .select("id, status, listed_at, views, sold, price, supplier_product_id, supplier_products(supplier_id)")
    .eq("store_id", storeId)
    .eq("status", "active")
    .lt("listed_at", new Date(now.getTime() - days * 86_400_000).toISOString())
    .eq("views", 0)
    .eq("sold", 0)
    .limit(2000);
  const listings = (listingRows ?? []).map((l) => ({
    id: l.id as string,
    status: l.status as string,
    listedAt: l.listed_at as string | null,
    views: Number(l.views),
    sold: Number(l.sold),
    price: Number(l.price),
    supplierId: (l.supplier_products as unknown as { supplier_id: string } | null)?.supplier_id ?? null,
  }));
  if (!listings.length) {
    await updateAutomationState(storeId, orgId, { cleanup_last_run_at: now.toISOString() });
    return { candidates: 0 };
  }

  // Skip listings with an open or previously dismissed candidate (the seller already decided).
  const { data: existing } = await db
    .from("cleanup_candidates")
    .select("listing_id")
    .in("listing_id", listings.map((l) => l.id))
    .in("status", ["pending", "dismissed"]);
  const skip = new Set((existing ?? []).map((c) => c.listing_id as string));
  const found = selectCleanupCandidates(listings, days, now, skip);

  let products: ReplacementProduct[] = [];
  const listed = new Set<string>();
  if (found.length && rulesRow.cleanup_queue_replacements) {
    const supplierIds = [...new Set(listings.map((l) => l.supplierId).filter((s): s is string => !!s))];
    if (supplierIds.length) {
      const [{ data: prodRows }, { data: listedRows }] = await Promise.all([
        db.from("supplier_products").select("id, supplier_id, cost, shipping_cost, stock").eq("org_id", orgId).in("supplier_id", supplierIds).gt("stock", 0).limit(5000),
        db.from("listings").select("supplier_product_id").eq("store_id", storeId).not("supplier_product_id", "is", null),
      ]);
      products = (prodRows ?? []).map((p) => ({
        id: p.id as string,
        supplierId: p.supplier_id as string,
        cost: p.cost === null ? null : Number(p.cost),
        shippingCost: Number(p.shipping_cost) || 0,
        stock: p.stock as number | null,
      }));
      for (const r of listedRows ?? []) listed.add(r.supplier_product_id as string);
    }
  }

  const rules = guardRules(rulesRow);
  const used = new Set<string>();
  const byId = new Map(listings.map((l) => [l.id, l]));
  let inserted = 0;
  for (const c of found) {
    const stale = byId.get(c.listingId)!;
    const replacement = rulesRow.cleanup_queue_replacements ? pickReplacement(stale, products, listed, rules, used) : null;
    if (replacement) used.add(replacement.productId);
    const { error } = await db.from("cleanup_candidates").insert({
      org_id: orgId,
      listing_id: c.listingId,
      reason: c.reason,
      replacement_supplier_product_id: replacement?.productId ?? null,
    });
    if (!error) inserted++;
  }
  await updateAutomationState(storeId, orgId, { cleanup_last_run_at: now.toISOString() });
  return { candidates: inserted };
}

/** Ends the stale listing on eBay and optionally queues a draft replacement for the lister. */
export async function approveCleanup(
  candidateId: string,
  ctx: { orgId: string; userId: string },
  opts: { createReplacement: boolean },
): Promise<{ ok: boolean; message: string }> {
  const db = createAdminClient();
  const { data: c } = await db
    .from("cleanup_candidates")
    .select("id, status, listing_id, replacement_supplier_product_id, listings!inner(id, store_id, sku, title, status, ebay_offer_id, ebay_listing_id, quantity, price)")
    .eq("id", candidateId)
    .eq("org_id", ctx.orgId)
    .maybeSingle();
  if (!c) return { ok: false, message: "Candidate not found." };
  if (c.status !== "pending") return { ok: false, message: "This candidate was already decided." };
  const l = c.listings as unknown as {
    id: string;
    store_id: string;
    sku: string;
    title: string;
    status: string;
    ebay_offer_id: string | null;
    ebay_listing_id: string | null;
    quantity: number;
    price: string | number;
  };
  if (!l.ebay_offer_id) return { ok: false, message: `"${l.title}" has no eBay offer to end.` };

  try {
    const client = await getEbayClient(l.store_id);
    await withdrawOffer(client, l.ebay_offer_id);
  } catch (e) {
    return { ok: false, message: `"${l.title}": ${ebayErrorMessage(e)}` };
  }
  const now = new Date().toISOString();
  await db.from("listings").update({ status: "ended", ended_at: now, updated_at: now }).eq("id", l.id);
  await db.from("cleanup_candidates").update({ status: "applied" }).eq("id", c.id);
  await logActivity({
    orgId: ctx.orgId,
    storeId: l.store_id,
    actor: "user",
    userId: ctx.userId,
    entityType: "listing",
    entityId: l.id,
    action: "listing_ended",
    before: { status: l.status, offerId: l.ebay_offer_id, ebayListingId: l.ebay_listing_id, sku: l.sku },
    after: { status: "ended", reason: "Cleanup: no views or sales." },
    undoable: true,
  });

  let extra = "";
  if (opts.createReplacement && c.replacement_supplier_product_id) {
    extra = await createDraftReplacement(c.replacement_supplier_product_id as string, l.store_id, ctx.orgId, l.quantity);
  }
  return { ok: true, message: `"${l.title}" ended.${extra}` };
}

async function createDraftReplacement(productId: string, storeId: string, orgId: string, prevQty: number): Promise<string> {
  const db = createAdminClient();
  const { data: p } = await db
    .from("supplier_products")
    .select("id, external_id, title, cost, shipping_cost, stock, images, raw")
    .eq("id", productId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (!p || p.cost === null) return " The replacement product is no longer available.";
  const rules = guardRules(await loadStoreRules(storeId));
  const price = safePriceForMargin(rules.minNetMarginPct + REPRICE_TARGET_OVER_FLOOR_PCT, { supplierCost: Number(p.cost), supplierShipping: Number(p.shipping_cost) || 0 }, rules);
  if (price === null) return " No price for the replacement reaches the margin floor, so no draft was created.";
  const raw = (p.raw ?? {}) as { description?: string; attributes?: Record<string, string> };
  const baseSku = String(p.external_id).slice(0, 40);
  const row = {
    org_id: orgId,
    store_id: storeId,
    supplier_product_id: p.id,
    title: String(p.title ?? "Untitled product").slice(0, 80),
    description: raw.description ?? null,
    item_specifics: Object.fromEntries(Object.entries(raw.attributes ?? {}).map(([k, v]) => [k, [v]])),
    images: p.images ?? [],
    price,
    quantity: Math.max(1, Math.min(Number(p.stock) || 1, prevQty || 1)),
    status: "draft",
  };
  for (let i = 0; i < 3; i++) {
    const sku = i === 0 ? baseSku : `${baseSku}-${Math.random().toString(36).slice(2, 6)}`;
    const { error } = await db.from("listings").insert({ ...row, sku });
    if (!error) return " A draft replacement was added to Listings for you to review and publish.";
  }
  return " The draft replacement couldn't be created.";
}

export async function dismissCleanup(candidateId: string, orgId: string): Promise<void> {
  const db = createAdminClient();
  await db.from("cleanup_candidates").update({ status: "dismissed" }).eq("id", candidateId).eq("org_id", orgId).eq("status", "pending");
}
