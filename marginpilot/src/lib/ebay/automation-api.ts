import "server-only";
import type { EbayClient } from "./client";
import type { InventoryItem } from "./api";

/**
 * eBay endpoints used by the automation area (monitor, promotions, cleanup, undo)
 * that aren't in api.ts. Same conventions: one wrapper per endpoint.
 */

/* ---------------- Inventory ---------------- */

export function getInventoryItem(c: EbayClient, sku: string) {
  return c.request<InventoryItem & { sku?: string; locale?: string }>(`/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`);
}

/* ---------------- Marketing: promotions (markdown sales) ---------------- */

export type EbayPromotion = { promotionId: string; name: string; promotionStatus?: string; startDate?: string; endDate?: string };

/** Markdown sales whose name matches `name` (createMarkdownSale returns no body, so we look the id up). */
export async function findMarkdownSaleByName(c: EbayClient, name: string): Promise<EbayPromotion | null> {
  const res = await c.request<{ promotions?: EbayPromotion[] }>("/sell/marketing/v1/promotion", {
    query: { marketplace_id: c.marketplaceId, promotion_type: "MARKDOWN_SALE", q: name.slice(0, 90), limit: 50 },
  });
  return res.promotions?.find((p) => p.name === name.slice(0, 90)) ?? null;
}

/* ---------------- Marketing: campaigns and ads ---------------- */

export type EbayAd = { adId: string; listingId: string; bidPercentage?: string; adStatus?: string };

export async function getCampaignAds(c: EbayClient, campaignId: string): Promise<EbayAd[]> {
  const ads: EbayAd[] = [];
  for (let offset = 0; offset < 10_000; offset += 500) {
    const res = await c.request<{ ads?: EbayAd[]; total?: number }>(`/sell/marketing/v1/ad_campaign/${campaignId}/ad`, {
      query: { limit: 500, offset },
    });
    ads.push(...(res.ads ?? []));
    if (!res.ads || res.ads.length < 500) break;
  }
  return ads;
}
