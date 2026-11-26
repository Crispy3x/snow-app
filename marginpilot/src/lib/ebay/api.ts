import "server-only";
import type { EbayClient } from "./client";

/**
 * Typed wrappers for the eBay Sell API calls the app makes. Keep every eBay
 * endpoint here so paths and payloads live in one place.
 * Docs: https://developer.ebay.com/api-docs/sell/static/sell-landing.html
 */

export type Money = { value: string; currency: string };
export const usd = (n: number): Money => ({ value: n.toFixed(2), currency: "USD" });

/* ---------------- Identity ---------------- */

export function getUser(c: EbayClient) {
  return c.request<{ userId: string; username: string }>("/commerce/identity/v1/user/", { host: "apiz" });
}

/* ---------------- Account (policies, selling limits) ---------------- */

export async function getPolicies(c: EbayClient) {
  const q = { marketplace_id: c.marketplaceId };
  const [f, p, r] = await Promise.all([
    c.request<{ fulfillmentPolicies?: { fulfillmentPolicyId: string; name: string }[] }>("/sell/account/v1/fulfillment_policy", { query: q }),
    c.request<{ paymentPolicies?: { paymentPolicyId: string; name: string }[] }>("/sell/account/v1/payment_policy", { query: q }),
    c.request<{ returnPolicies?: { returnPolicyId: string; name: string }[] }>("/sell/account/v1/return_policy", { query: q }),
  ]);
  return { fulfillment: f.fulfillmentPolicies ?? [], payment: p.paymentPolicies ?? [], return: r.returnPolicies ?? [] };
}

export function getPrivileges(c: EbayClient) {
  return c.request<{ sellingLimit?: { amount?: Money; quantity?: number }; sellerRegistrationCompleted?: boolean }>(
    "/sell/account/v1/privilege",
  );
}

/* ---------------- Inventory (items, offers, publish) ---------------- */

export type InventoryItem = {
  availability: { shipToLocationAvailability: { quantity: number } };
  condition: "NEW" | "USED_EXCELLENT" | "USED_GOOD";
  product: {
    title: string;
    description: string;
    aspects: Record<string, string[]>;
    imageUrls: string[];
    brand?: string;
    mpn?: string;
  };
};

export function putInventoryItem(c: EbayClient, sku: string, item: InventoryItem) {
  return c.request<void>(`/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`, { method: "PUT", body: item });
}

export type OfferInput = {
  sku: string;
  categoryId: string;
  price: number;
  quantity: number;
  listingDescription: string;
  policies: { fulfillmentPolicyId: string; paymentPolicyId: string; returnPolicyId: string };
  merchantLocationKey: string;
};

function offerBody(c: EbayClient, o: OfferInput) {
  return {
    sku: o.sku,
    marketplaceId: c.marketplaceId,
    format: "FIXED_PRICE",
    availableQuantity: o.quantity,
    categoryId: o.categoryId,
    listingDescription: o.listingDescription,
    listingPolicies: o.policies,
    merchantLocationKey: o.merchantLocationKey,
    pricingSummary: { price: usd(o.price) },
  };
}

export function createOffer(c: EbayClient, o: OfferInput) {
  return c.request<{ offerId: string }>("/sell/inventory/v1/offer", { method: "POST", body: offerBody(c, o) });
}

export function updateOffer(c: EbayClient, offerId: string, o: OfferInput) {
  return c.request<void>(`/sell/inventory/v1/offer/${offerId}`, { method: "PUT", body: offerBody(c, o) });
}

export function publishOffer(c: EbayClient, offerId: string) {
  return c.request<{ listingId: string }>(`/sell/inventory/v1/offer/${offerId}/publish`, { method: "POST" });
}

/** Ends the listing. It can be relisted later with publishOffer (used by undo). */
export function withdrawOffer(c: EbayClient, offerId: string) {
  return c.request<{ listingId: string }>(`/sell/inventory/v1/offer/${offerId}/withdraw`, { method: "POST" });
}

export type PriceQtyUpdate = { sku: string; offerId: string; price?: number; quantity?: number };

/** Up to 25 SKUs per call. Used by the monitor, repricing and undo. */
export function bulkUpdatePriceQuantity(c: EbayClient, updates: PriceQtyUpdate[]) {
  return c.request<{ responses: { sku: string; offerId?: string; statusCode: number; errors?: unknown[] }[] }>(
    "/sell/inventory/v1/bulk_update_price_quantity",
    {
      method: "POST",
      body: {
        requests: updates.map((u) => ({
          sku: u.sku,
          ...(u.quantity !== undefined ? { shipToLocationAvailability: { quantity: u.quantity } } : {}),
          offers: [
            {
              offerId: u.offerId,
              ...(u.quantity !== undefined ? { availableQuantity: u.quantity } : {}),
              ...(u.price !== undefined ? { price: usd(u.price) } : {}),
            },
          ],
        })),
      },
    },
  );
}

export function createLocation(c: EbayClient, key: string, address: { postalCode: string; country: string; city?: string; stateOrProvince?: string }) {
  return c.request<void>(`/sell/inventory/v1/location/${encodeURIComponent(key)}`, {
    method: "POST",
    body: { location: { address }, locationTypes: ["WAREHOUSE"], name: "Supplier warehouse", merchantLocationStatus: "ENABLED" },
  });
}

export function getLocations(c: EbayClient) {
  return c.request<{ locations?: { merchantLocationKey: string }[] }>("/sell/inventory/v1/location");
}

/* ---------------- Taxonomy (category suggestions) ---------------- */

export async function suggestCategory(c: EbayClient, query: string): Promise<{ categoryId: string; categoryName: string } | null> {
  const treeId = c.marketplaceId === "EBAY_US" ? "0" : "0"; // EBAY_US tree id is 0; look up others via get_default_category_tree_id
  const res = await c.request<{ categorySuggestions?: { category: { categoryId: string; categoryName: string } }[] }>(
    `/commerce/taxonomy/v1/category_tree/${treeId}/get_category_suggestions`,
    { query: { q: query.slice(0, 350) } },
  );
  return res.categorySuggestions?.[0]?.category ?? null;
}

export function getItemAspects(c: EbayClient, categoryId: string) {
  return c.request<{ aspects?: { localizedAspectName: string; aspectConstraint: { aspectRequired?: boolean } }[] }>(
    `/commerce/taxonomy/v1/category_tree/0/get_item_aspects_for_category`,
    { query: { category_id: categoryId } },
  );
}

/* ---------------- Fulfillment (orders, tracking) ---------------- */

export type EbayOrder = {
  orderId: string;
  creationDate: string;
  orderFulfillmentStatus: "NOT_STARTED" | "IN_PROGRESS" | "FULFILLED";
  cancelStatus?: { cancelState?: string };
  buyer: { username: string };
  pricingSummary: { total: Money };
  totalMarketplaceFee?: Money;
  lineItems: { lineItemId: string; sku?: string; legacyItemId: string; title: string; quantity: number; lineItemCost: Money }[];
  fulfillmentStartInstructions?: {
    shippingStep?: {
      shipTo?: {
        fullName?: string;
        contactAddress?: { addressLine1?: string; addressLine2?: string; city?: string; stateOrProvince?: string; postalCode?: string; countryCode?: string };
        primaryPhone?: { phoneNumber?: string };
      };
    };
    maxEstimatedDeliveryDate?: string;
  }[];
  lineItemFulfillmentInstructions?: { shipByDate?: string }[];
};

export function getOrders(c: EbayClient, sinceIso: string, offset = 0) {
  return c.request<{ orders?: EbayOrder[]; total?: number; next?: string }>("/sell/fulfillment/v1/order", {
    query: { filter: `creationdate:[${sinceIso}..]`, limit: 50, offset },
  });
}

export function createShippingFulfillment(
  c: EbayClient,
  orderId: string,
  input: { lineItems: { lineItemId: string; quantity: number }[]; carrier: string; trackingNumber: string; shippedDate?: string },
) {
  return c.request<void>(`/sell/fulfillment/v1/order/${orderId}/shipping_fulfillment`, {
    method: "POST",
    body: {
      lineItems: input.lineItems,
      shippedDate: input.shippedDate ?? new Date().toISOString(),
      shippingCarrierCode: input.carrier,
      trackingNumber: input.trackingNumber,
    },
  });
}

/* ---------------- Negotiation (offers to watchers) ---------------- */

export function findEligibleItems(c: EbayClient, offset = 0) {
  return c.request<{ eligibleItems?: { listingId: string }[]; total?: number }>("/sell/negotiation/v1/find_eligible_items", {
    query: { limit: 200, offset },
  });
}

export function sendOfferToInterestedBuyers(c: EbayClient, listingId: string, price: number, message: string) {
  return c.request<{ offers?: { offerId: string; listingId: string; offerStatus: string }[] }>(
    "/sell/negotiation/v1/send_offer_to_interested_buyers",
    {
      method: "POST",
      body: {
        allowCounterOffer: false,
        message: message.slice(0, 2000),
        offerDuration: { unit: "DAY", value: 2 },
        offeredItems: [{ listingId, price: usd(price), quantity: 1 }],
      },
    },
  );
}

/* ---------------- Marketing (sale events, promoted listings) ---------------- */

export function createMarkdownSale(
  c: EbayClient,
  input: { name: string; percentOff: number; listingIds: string[]; startDate: string; endDate: string },
) {
  return c.request<void>("/sell/marketing/v1/item_price_markdown", {
    method: "POST",
    body: {
      name: input.name.slice(0, 90),
      marketplaceId: c.marketplaceId,
      startDate: input.startDate,
      endDate: input.endDate,
      promotionStatus: "SCHEDULED",
      selectedInventoryDiscounts: [
        {
          discountBenefit: { percentageOffItem: String(input.percentOff) },
          inventoryCriterion: { inventoryCriterionType: "INVENTORY_BY_VALUE", listingIds: input.listingIds },
        },
      ],
    },
  });
}

export function createCostPerSaleCampaign(c: EbayClient, name: string, defaultBidPct: number) {
  return c.request<void>("/sell/marketing/v1/ad_campaign", {
    method: "POST",
    body: {
      campaignName: name.slice(0, 80),
      marketplaceId: c.marketplaceId,
      startDate: new Date().toISOString(),
      fundingStrategy: { fundingModel: "COST_PER_SALE", bidPercentage: defaultBidPct.toFixed(1) },
    },
  });
}

export function getCampaigns(c: EbayClient) {
  return c.request<{ campaigns?: { campaignId: string; campaignName: string; campaignStatus: string }[] }>("/sell/marketing/v1/ad_campaign", {
    query: { limit: 100 },
  });
}

export function bulkCreateAds(c: EbayClient, campaignId: string, ads: { listingId: string; bidPct: number }[]) {
  return c.request<{ responses?: { listingId: string; statusCode: number }[] }>(
    `/sell/marketing/v1/ad_campaign/${campaignId}/bulk_create_ads_by_listing_id`,
    { method: "POST", body: { requests: ads.map((a) => ({ listingId: a.listingId, bidPercentage: a.bidPct.toFixed(1) })) } },
  );
}

export function bulkUpdateAdBids(c: EbayClient, campaignId: string, ads: { listingId: string; bidPct: number }[]) {
  return c.request<unknown>(`/sell/marketing/v1/ad_campaign/${campaignId}/bulk_update_ads_bid_by_listing_id`, {
    method: "POST",
    body: { requests: ads.map((a) => ({ listingId: a.listingId, bidPercentage: a.bidPct.toFixed(1) })) },
  });
}

/* ---------------- Analytics (views) ---------------- */

const ymd = (d: Date) => d.toISOString().slice(0, 10).replaceAll("-", "");

export function getListingTraffic(c: EbayClient, from: Date, to: Date) {
  return c.request<{
    records?: { dimensionValues: { value: string }[]; metricValues: { value: number }[] }[];
    header?: { metrics?: { key: string }[] };
  }>("/sell/analytics/v1/traffic_report", {
    query: {
      dimension: "LISTING",
      metric: "LISTING_VIEWS_TOTAL,TRANSACTION",
      filter: `marketplace_ids:{${c.marketplaceId}},date_range:[${ymd(from)}..${ymd(to)}]`,
    },
  });
}

/* ---------------- Messages (buyer conversations) ----------------
 * REST Message API (commerce/message/v1). Replies are only sent after the
 * seller approves a draft in the app; nothing here is called automatically.
 */

export function getConversations(c: EbayClient, offset = 0) {
  return c.request<{
    conversations?: {
      conversationId: string;
      conversationTitle?: string;
      latestMessage?: { messageBody?: string; senderUsername?: string; createdDate?: string };
      unreadCount?: number;
      referenceId?: string;
    }[];
  }>("/commerce/message/v1/conversation", { query: { conversation_type: "FROM_MEMBERS", limit: 25, offset } });
}

export function getConversation(c: EbayClient, conversationId: string) {
  return c.request<{ messages?: { messageBody: string; senderUsername: string; createdDate: string }[] }>(
    `/commerce/message/v1/conversation/${conversationId}`,
    { query: { conversation_type: "FROM_MEMBERS", limit: 50 } },
  );
}

export function sendMessage(c: EbayClient, conversationId: string, messageText: string) {
  return c.request<unknown>("/commerce/message/v1/send_message", {
    method: "POST",
    body: { conversationId, messageText: messageText.slice(0, 2000) },
  });
}
