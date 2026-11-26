"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStore } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { assertWithinLimit, PlanLimitError } from "@/lib/limits";
import { guardPrice } from "@/lib/margin";
import { getAdapter, resolveAdapter, SupplierError, type SupplierProduct } from "@/lib/suppliers";
import { makeSku, priceListing } from "@/lib/lister/pricing";
import { loadStoreRules } from "@/lib/lister/store";
import { sanitizeDescription } from "@/lib/lister/text";
import { checkVero, type VeroResult } from "@/lib/lister/vero";
import { writeListing } from "@/lib/lister/writer";

export type WriterDraft = {
  requestId: string;
  title: string;
  description: string;
  itemSpecifics: Record<string, string[]>;
  vero: VeroResult;
  images: string[];
  suggestedPrice: number | null;
  cost: number | null;
  shipping: number | null;
  stock: number | null;
  source: { supplierId: string; ref: string; product: SupplierProduct } | null;
};

export type WriterState = { ok?: boolean; message?: string; draft?: WriterDraft; saved?: { listingId: string } } | null;

const looksLikeRef = (s: string) => !/\s/.test(s) && (/^https?:\/\//i.test(s) || /^[a-z_]+:[\w-]+$/i.test(s));

export async function generateDraft(_prev: WriterState, formData: FormData): Promise<WriterState> {
  const ctx = await requireStore();
  const input = String(formData.get("input") ?? "").trim();
  const supplierId = String(formData.get("supplierId") ?? "");
  if (input.length < 3) return { ok: false, message: "Paste a supplier link or the supplier's product text." };
  if (input.length > 20_000) return { ok: false, message: "That text is too long. Paste just one product." };

  let product: SupplierProduct | undefined;
  let source: WriterDraft["source"] = null;
  if (looksLikeRef(input)) {
    let adapterKey: string;
    try {
      adapterKey = resolveAdapter(input).key;
    } catch (e) {
      return { ok: false, message: e instanceof SupplierError ? e.message : "That link isn't supported." };
    }
    const supabase = await createClient();
    let q = supabase.from("suppliers").select("id, adapter, config").eq("org_id", ctx.org.id).eq("adapter", adapterKey).eq("wholesale_attested", true);
    if (supplierId) q = q.eq("id", supplierId);
    const { data: suppliers } = await q.limit(1);
    const supplier = suppliers?.[0];
    if (!supplier) return { ok: false, message: "Add this supplier on the Suppliers page (with the wholesale confirmation) first, or choose the right supplier." };
    try {
      product = await getAdapter(supplier.adapter).fetchProduct(input, (supplier.config as Record<string, unknown>) ?? {});
    } catch (e) {
      return { ok: false, message: e instanceof SupplierError ? e.message : "Couldn't read that product from the supplier." };
    }
    source = { supplierId: supplier.id, ref: input, product };
  } else if (/https?:\/\/\S+/i.test(input) && resolveFails(input)) {
    return { ok: false, message: "The text contains a retail store or marketplace link. eBay only allows drop shipping from wholesale suppliers." };
  }

  const res = await writeListing({ orgId: ctx.org.id, userId: ctx.user.id, storeId: ctx.store.id, input: product ? { product } : { rawText: input } });
  if (!res.ok) return { ok: false, message: res.message };

  let suggestedPrice: number | null = null;
  if (product) {
    const rules = await loadStoreRules(ctx.store.id);
    suggestedPrice = priceListing(rules.minNetMarginPct, { supplierCost: product.cost, supplierShipping: product.shippingCost }, rules).price;
  }
  return {
    ok: true,
    message: "Draft ready. Review and edit it before saving.",
    draft: {
      requestId: res.requestId,
      ...res.draft,
      images: product?.images ?? [],
      suggestedPrice,
      cost: product?.cost ?? null,
      shipping: product?.shippingCost ?? null,
      stock: product?.stock ?? null,
      source,
    },
  };
}

/** True when any URL in free text is a blocked retail link. */
function resolveFails(text: string): boolean {
  for (const m of text.matchAll(/https?:\/\/\S+/gi)) {
    try {
      resolveAdapter(m[0]);
    } catch (e) {
      if (e instanceof SupplierError && e.code === "blocked_retail") return true;
    }
  }
  return false;
}

const saveSchema = z.object({
  requestId: z.string().uuid(),
  title: z.string().trim().min(10, "Titles need at least 10 characters.").max(80, "eBay titles are at most 80 characters."),
  description: z.string().min(1).max(50_000),
  specifics: z.string().max(20_000),
  price: z.coerce.number().positive("Enter a price above 0."),
  cost: z.coerce.number().min(0, "Enter your cost."),
  shipping: z.coerce.number().min(0).default(0),
  quantity: z.coerce.number().int().min(0).max(10_000),
  images: z.string().max(20_000).optional(),
  supplierId: z.string().optional(),
  sourceRef: z.string().optional(),
});

export async function saveDraftListing(_prev: WriterState, formData: FormData): Promise<WriterState> {
  const ctx = await requireStore();
  const parsed = saveSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the fields." };
  const d = parsed.data;
  const supabase = await createClient();

  const { data: reqRow } = await supabase.from("ai_requests").select("id, output").eq("id", d.requestId).eq("org_id", ctx.org.id).maybeSingle();
  if (!reqRow) return { ok: false, message: "That draft has expired. Generate it again." };

  try {
    await assertWithinLimit(ctx.org.id, "listings", 1);
  } catch (e) {
    if (e instanceof PlanLimitError) return { ok: false, message: e.message };
    throw e;
  }

  let specifics: Record<string, string[]> = {};
  try {
    const raw = JSON.parse(d.specifics || "{}") as Record<string, unknown>;
    for (const [k, v] of Object.entries(raw)) if (Array.isArray(v)) specifics[k.slice(0, 65)] = v.map(String).filter(Boolean).slice(0, 10);
  } catch {
    specifics = {};
  }
  const images = (d.images ?? "").split("\n").map((s) => s.trim()).filter((s) => /^https:\/\//.test(s)).slice(0, 24);

  // Link to the supplier product when the draft came from a supplier link.
  let supplierProductId: string | null = null;
  if (d.supplierId && d.sourceRef) {
    const { data: supplier } = await supabase.from("suppliers").select("id, adapter, config").eq("id", d.supplierId).eq("org_id", ctx.org.id).maybeSingle();
    if (supplier) {
      try {
          const p = await getAdapter(supplier.adapter).fetchProduct(d.sourceRef, (supplier.config as Record<string, unknown>) ?? {});
        const { data: sp } = await supabase
          .from("supplier_products")
          .upsert(
            { org_id: ctx.org.id, supplier_id: supplier.id, external_id: p.externalId, source_url: p.sourceUrl, title: p.title, cost: p.cost, shipping_cost: p.shippingCost, stock: p.stock, images: p.images, raw: p, last_checked_at: new Date().toISOString() },
            { onConflict: "supplier_id,external_id" },
          )
          .select("id")
          .single();
        supplierProductId = (sp?.id as string) ?? null;
      } catch {
        supplierProductId = null;
      }
    }
  }

  const rules = await loadStoreRules(ctx.store.id);
  const guard = guardPrice(d.price, { supplierCost: d.cost, supplierShipping: d.shipping }, rules);
  const description = sanitizeDescription(d.description);
  const vero = checkVero(`${d.title}\n${description}\n${Object.entries(specifics).map(([k, v]) => `${k}: ${v.join(", ")}`).join("\n")}`);
  const aiVero = ((reqRow.output as { vero?: VeroResult } | null)?.vero ?? null);
  const risk = aiVero && aiVero.risk === "high" ? "high" : vero.risk;

  const { data: listing, error } = await supabase
    .from("listings")
    .insert({
      org_id: ctx.org.id,
      store_id: ctx.store.id,
      supplier_product_id: supplierProductId,
      sku: makeSku(),
      title: d.title,
      description,
      item_specifics: specifics,
      images,
      price: d.price,
      quantity: d.quantity,
      status: guard.ok ? "draft" : "blocked_margin",
      net_margin_pct: guard.breakdown.marginPct,
      margin_reasons: guard.ok ? [] : guard.reasons,
      last_error: guard.ok ? null : guard.reasons.join(" "),
      manual_cost: supplierProductId ? null : d.cost,
      manual_shipping_cost: supplierProductId ? null : d.shipping,
      vero_risk: risk,
      vero_flags: [...new Set([...(aiVero?.reasons ?? []), ...vero.reasons])],
    })
    .select("id")
    .single();
  if (error || !listing) return { ok: false, message: "Couldn't save the draft listing. Please try again." };

  await supabase.from("ai_requests").update({ draft_status: "applied" }).eq("id", d.requestId).eq("org_id", ctx.org.id);
  revalidatePath("/app/listings");
  return {
    ok: true,
    message: guard.ok ? "Saved as a draft listing." : `Saved, but blocked by the margin guard: ${guard.reasons.join(" ")}`,
    saved: { listingId: listing.id as string },
  };
}

export async function discardDraft(formData: FormData) {
  const ctx = await requireStore();
  const requestId = String(formData.get("requestId") ?? "");
  if (!z.string().uuid().safeParse(requestId).success) return;
  const supabase = await createClient();
  await supabase.from("ai_requests").update({ draft_status: "rejected" }).eq("id", requestId).eq("org_id", ctx.org.id);
}
