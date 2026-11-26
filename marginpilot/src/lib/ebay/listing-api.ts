import "server-only";
import type { EbayClient } from "./client";
import type { InventoryItem } from "./api";

/**
 * Extra Inventory API wrappers used by the lister (kept apart from api.ts so the
 * lister area owns them). Docs: https://developer.ebay.com/api-docs/sell/inventory/
 */

export type EbayOffer = {
  offerId: string;
  sku: string;
  status?: "PUBLISHED" | "UNPUBLISHED";
  listing?: { listingId?: string; listingStatus?: string };
};

/** Offers already created for a SKU (to recover after a partial publish). */
export async function getOffersBySku(c: EbayClient, sku: string): Promise<EbayOffer[]> {
  const res = await c.request<{ offers?: EbayOffer[] }>("/sell/inventory/v1/offer", {
    query: { sku, marketplace_id: c.marketplaceId, limit: 25 },
  });
  return res.offers ?? [];
}

export function getInventoryItem(c: EbayClient, sku: string) {
  return c.request<InventoryItem & { sku: string }>(`/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`);
}
