import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getEbayClient, EbayApiError, EbayRateLimitError } from "@/lib/ebay/client";
import { bulkUpdatePriceQuantity, createOffer, publishOffer, putInventoryItem, suggestCategory, updateOffer, withdrawOffer, type InventoryItem } from "@/lib/ebay/api";
import { getOffersBySku } from "@/lib/ebay/listing-api";
import { logActivity } from "@/lib/activity";
import { guardPrice, type CostInputs } from "@/lib/margin";
import { getStorePolicies, loadStoreRules } from "./store";
import { htmlToText } from "./text";

/**
 * Publishing, revising and ending listings on eBay. Every publish re-runs the
 * margin guard at the worst-case ad rate first: nothing goes live below the floor.
 */

export const LISTING_COLUMNS =
  "id, org_id, store_id, supplier_product_id, sku, ebay_offer_id, ebay_listing_id, category_id, title, description, item_specifics, images, price, quantity, status, net_margin_pct, ad_rate_pct, manual_cost, manual_shipping_cost, last_error, supplier_products(cost, shipping_cost, title)";

export type ListingRow = {
  id: string;
  org_id: string;
  store_id: string;
  supplier_product_id: string | null;
  sku: string;
  ebay_offer_id: string | null;
  ebay_listing_id: string | null;
  category_id: string | null;
  title: string;
  description: string | null;
  item_specifics: Record<string, string[]> | null;
  images: string[] | null;
  price: number | string;
  quantity: number;
  status: string;
  net_margin_pct: number | string | null;
  ad_rate_pct: number | string | null;
  manual_cost: number | string | null;
  manual_shipping_cost: number | string | null;
  last_error: string | null;
  supplier_products: { cost: number | string | null; shipping_cost: number | string | null; title: string | null } | null;
};

/** Cost used for margin: the supplier product's when linked, else the manual cost. */
export function listingCost(l: Pick<ListingRow, "supplier_products" | "manual_cost" | "manual_shipping_cost">): CostInputs | null {
  const sp = Array.isArray(l.supplier_products) ? l.supplier_products[0] : l.supplier_products;
  if (sp && sp.cost !== null && sp.cost !== undefined) return { supplierCost: Number(sp.cost), supplierShipping: Number(sp.shipping_cost ?? 0) };
  if (l.manual_cost !== null && l.manual_cost !== undefined) return { supplierCost: Number(l.manual_cost), supplierShipping: Number(l.manual_shipping_cost ?? 0) };
  return null;
}

export function buildInventoryItem(l: Pick<ListingRow, "title" | "description" | "item_specifics" | "images" | "quantity">): InventoryItem {
  const aspects = l.item_specifics ?? {};
  const brand = Object.entries(aspects).find(([k]) => k.toLowerCase() === "brand")?.[1]?.[0];
  return {
    availability: { shipToLocationAvailability: { quantity: l.quantity } },
    condition: "NEW",
    product: {
      title: l.title.slice(0, 80),
      description: htmlToText(l.description ?? "").slice(0, 4000),
      aspects,
      imageUrls: (l.images ?? []).slice(0, 24),
      ...(brand ? { brand } : {}),
    },
  };
}

export type PublishOutcome =
  | { ok: true; status: "active"; listingId: string; offerId: string }
  | { ok: false; status: "blocked_margin" | "draft" | "error"; message: string };

export async function loadListing(listingId: string, orgId: string): Promise<ListingRow | null> {
  const db = createAdminClient();
  const { data } = await db.from("listings").select(LISTING_COLUMNS).eq("id", listingId).eq("org_id", orgId).maybeSingle();
  return (data as unknown as ListingRow) ?? null;
}

/**
 * Guard, then put inventory item, create/update offer and publish.
 * EbayRateLimitError is re-thrown so jobs can back off; other eBay errors are
 * stored on the listing (status error) and returned.
 */
export async function publishListing(l: ListingRow, actor: { type: "automation" | "user"; userId: string | null }): Promise<PublishOutcome> {
  const db = createAdminClient();
  const cost = listingCost(l);
  if (!cost) {
    const message = "Add the item's cost before publishing so the margin can be checked.";
    await db.from("listings").update({ last_error: message, updated_at: new Date().toISOString() }).eq("id", l.id);
    return { ok: false, status: "draft", message };
  }
  const rules = await loadStoreRules(l.store_id);
  const price = Number(l.price);
  const guard = guardPrice(price, cost, rules);
  if (!guard.ok) {
    await db
      .from("listings")
      .update({ status: "blocked_margin", margin_reasons: guard.reasons, net_margin_pct: guard.breakdown.marginPct, last_error: guard.reasons.join(" "), updated_at: new Date().toISOString() })
      .eq("id", l.id);
    return { ok: false, status: "blocked_margin", message: guard.reasons.join(" ") };
  }

  const pol = await getStorePolicies(l.store_id);
  if (!pol.ok) {
    await db.from("listings").update({ status: "draft", last_error: pol.message, updated_at: new Date().toISOString() }).eq("id", l.id);
    return { ok: false, status: "draft", message: pol.message };
  }
  if (!(l.images ?? []).length) {
    const message = "Add at least one photo before publishing.";
    await db.from("listings").update({ status: "draft", last_error: message, updated_at: new Date().toISOString() }).eq("id", l.id);
    return { ok: false, status: "draft", message };
  }

  try {
    const c = await getEbayClient(l.store_id);
    let categoryId = l.category_id;
    if (!categoryId) {
      categoryId = (await suggestCategory(c, l.title))?.categoryId ?? null;
      if (!categoryId) throw new EbayApiError("eBay couldn't suggest a category for this title. Set a category and try again.", 400);
    }
    await db.from("listings").update({ status: "publishing", category_id: categoryId }).eq("id", l.id);

    await putInventoryItem(c, l.sku, buildInventoryItem(l));
    const offerInput = {
      sku: l.sku,
      categoryId,
      price,
      quantity: l.quantity,
      listingDescription: l.description || l.title,
      policies: pol.value.policies,
      merchantLocationKey: pol.value.merchantLocationKey,
    };
    let offerId = l.ebay_offer_id ?? (await getOffersBySku(c, l.sku).catch(() => []))[0]?.offerId ?? null;
    if (offerId) await updateOffer(c, offerId, offerInput);
    else offerId = (await createOffer(c, offerInput)).offerId;
    await db.from("listings").update({ ebay_offer_id: offerId }).eq("id", l.id);
    const { listingId } = await publishOffer(c, offerId);

    const adRate = rules.adRateTiers?.length ? undefined : rules.adRatePct;
    await db
      .from("listings")
      .update({
        status: "active",
        ebay_offer_id: offerId,
        ebay_listing_id: listingId,
        listed_at: new Date().toISOString(),
        ended_at: null,
        net_margin_pct: guard.breakdown.marginPct,
        ...(adRate !== undefined ? { ad_rate_pct: adRate } : {}),
        margin_reasons: [],
        last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", l.id);
    await logActivity({
      orgId: l.org_id,
      storeId: l.store_id,
      actor: actor.type,
      userId: actor.userId,
      entityType: "listing",
      entityId: l.id,
      action: "listing_published",
      before: { status: l.status },
      after: { status: "active", price, ebay_listing_id: listingId, offer_id: offerId, sku: l.sku },
      undoable: true, // reversed by withdrawing the offer
    });
    return { ok: true, status: "active", listingId, offerId };
  } catch (e) {
    if (e instanceof EbayRateLimitError) {
      await db.from("listings").update({ status: l.status === "publishing" ? "draft" : l.status }).eq("id", l.id);
      throw e;
    }
    const message = e instanceof EbayApiError ? `eBay: ${e.message}` : e instanceof Error ? e.message : "Publishing failed";
    await db.from("listings").update({ status: "error", last_error: message.slice(0, 1000), updated_at: new Date().toISOString() }).eq("id", l.id);
    return { ok: false, status: "error", message };
  }
}

/** End a live listing (withdraw the offer). Undoable: the offer can be published again. */
export async function endListing(l: ListingRow, userId: string | null): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!l.ebay_offer_id || l.status !== "active") return { ok: false, message: "Only live listings can be ended." };
  const db = createAdminClient();
  try {
    const c = await getEbayClient(l.store_id);
    await withdrawOffer(c, l.ebay_offer_id);
  } catch (e) {
    return { ok: false, message: e instanceof EbayRateLimitError ? "eBay is rate limiting requests. Try again in a minute." : e instanceof Error ? `eBay: ${e.message}` : "Couldn't end the listing." };
  }
  const now = new Date().toISOString();
  await db.from("listings").update({ status: "ended", ended_at: now, updated_at: now }).eq("id", l.id);
  await logActivity({
    orgId: l.org_id,
    storeId: l.store_id,
    actor: "user",
    userId,
    entityType: "listing",
    entityId: l.id,
    action: "listing_ended",
    before: { status: l.status, offer_id: l.ebay_offer_id, ebay_listing_id: l.ebay_listing_id },
    after: { status: "ended" },
    undoable: true,
  });
  return { ok: true };
}

/** Push edited title/description/specifics/images/quantity (inventory item) and price (offer) of a live listing. */
export async function reviseLiveListing(l: ListingRow): Promise<void> {
  const c = await getEbayClient(l.store_id);
  await putInventoryItem(c, l.sku, buildInventoryItem(l));
  if (l.ebay_offer_id && l.category_id) {
    const pol = await getStorePolicies(l.store_id);
    if (pol.ok) {
      await updateOffer(c, l.ebay_offer_id, {
        sku: l.sku,
        categoryId: l.category_id,
        price: Number(l.price),
        quantity: l.quantity,
        listingDescription: l.description || l.title,
        policies: pol.value.policies,
        merchantLocationKey: pol.value.merchantLocationKey,
      });
      return;
    }
  }
  if (l.ebay_offer_id) await bulkUpdatePriceQuantity(c, [{ sku: l.sku, offerId: l.ebay_offer_id, price: Number(l.price), quantity: l.quantity }]);
}
