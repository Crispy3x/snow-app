import type { EbayOrder } from "@/lib/ebay/api";

/**
 * Order queue: map an eBay order to our rows. Pure, no I/O (encryption is passed in).
 *
 * Buyer data (docs/PLAN.md §4 D): only the ship-to needed to fulfil the order is kept,
 * encrypted, readable server-side only, and purged PII_RETENTION_DAYS after the order.
 */

/** Days after order creation when the encrypted ship-to is deleted (covers a 30-day return window plus slack). */
export const PII_RETENTION_DAYS = 60;
/** Ship-by is "near" within this many hours. */
export const SHIP_BY_WARNING_HOURS = 24;

export type ShipTo = {
  name: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  stateOrProvince: string;
  postalCode: string;
  countryCode: string;
  phone?: string;
};

export type ListingMatch = { id: string; supplierCost: number | null };

export type OrderRow = {
  org_id: string;
  store_id: string;
  ebay_order_id: string;
  status: "new" | "shipped" | "cancelled";
  order_total: number;
  ebay_fees: number | null;
  buyer_username: string | null;
  ship_to_enc: string | null;
  ship_by: string;
  pii_purge_after: string;
  created_on_ebay: string;
};

export type OrderLineRow = {
  org_id: string;
  ebay_line_item_id: string;
  listing_id: string | null;
  sku: string | null;
  quantity: number;
  sale_price: number; // per unit
  supplier_cost: number | null; // per unit
};

const DAY = 86_400_000;

export function extractShipTo(o: EbayOrder): ShipTo | null {
  const s = o.fulfillmentStartInstructions?.find((f) => f.shippingStep?.shipTo)?.shippingStep?.shipTo;
  if (!s) return null;
  const a = s.contactAddress ?? {};
  return {
    name: s.fullName ?? "",
    addressLine1: a.addressLine1 ?? "",
    ...(a.addressLine2 ? { addressLine2: a.addressLine2 } : {}),
    city: a.city ?? "",
    stateOrProvince: a.stateOrProvince ?? "",
    postalCode: a.postalCode ?? "",
    countryCode: a.countryCode ?? "",
    ...(s.primaryPhone?.phoneNumber ? { phone: s.primaryPhone.phoneNumber } : {}),
  };
}

/** Address block for the "Copy address" button. */
export function formatShipTo(s: ShipTo): string {
  return [
    s.name,
    s.addressLine1,
    s.addressLine2,
    `${s.city}, ${s.stateOrProvince} ${s.postalCode}`.trim(),
    s.countryCode,
    s.phone,
  ]
    .filter((l) => l && l.trim() && l.trim() !== ",")
    .join("\n");
}

export function orderStatusFromEbay(o: EbayOrder): OrderRow["status"] {
  const cancel = o.cancelStatus?.cancelState;
  if (cancel === "CANCELED" || cancel === "CANCELLED") return "cancelled";
  if (o.orderFulfillmentStatus === "FULFILLED") return "shipped";
  return "new";
}

export function mapEbayOrder(
  o: EbayOrder,
  opts: {
    orgId: string;
    storeId: string;
    handlingDays: number;
    now: Date;
    encrypt: (value: unknown) => string;
    listingsBySku: Map<string, ListingMatch>;
  },
): { order: OrderRow; lines: OrderLineRow[] } {
  const created = new Date(o.creationDate);
  const purgeAfter = new Date(created.getTime() + PII_RETENTION_DAYS * DAY);

  const shipByDates = (o.lineItemFulfillmentInstructions ?? [])
    .map((i) => (i.shipByDate ? Date.parse(i.shipByDate) : NaN))
    .filter((n) => Number.isFinite(n));
  const shipBy = shipByDates.length ? new Date(Math.min(...shipByDates)) : new Date(created.getTime() + opts.handlingDays * DAY);

  const shipTo = extractShipTo(o);
  // Never store PII for an order that's already past its retention date.
  const keepPii = shipTo !== null && purgeAfter.getTime() > opts.now.getTime();

  const order: OrderRow = {
    org_id: opts.orgId,
    store_id: opts.storeId,
    ebay_order_id: o.orderId,
    status: orderStatusFromEbay(o),
    order_total: Number(o.pricingSummary.total.value),
    ebay_fees: o.totalMarketplaceFee ? Number(o.totalMarketplaceFee.value) : null,
    buyer_username: o.buyer?.username ?? null,
    ship_to_enc: keepPii ? opts.encrypt(shipTo) : null,
    ship_by: shipBy.toISOString(),
    pii_purge_after: purgeAfter.toISOString(),
    created_on_ebay: created.toISOString(),
  };

  const lines: OrderLineRow[] = o.lineItems.map((li) => {
    const match = li.sku ? opts.listingsBySku.get(li.sku) : undefined;
    return {
      org_id: opts.orgId,
      ebay_line_item_id: li.lineItemId,
      listing_id: match?.id ?? null,
      sku: li.sku ?? null,
      quantity: li.quantity,
      // lineItemCost is the line total; order_lines.sale_price is per unit.
      sale_price: Math.round((Number(li.lineItemCost.value) / Math.max(1, li.quantity)) * 100) / 100,
      supplier_cost: match?.supplierCost ?? null,
    };
  });

  return { order, lines };
}

export type ShipByState = "late" | "soon" | "ok";

export function shipByState(shipBy: string | null, now: Date): ShipByState {
  if (!shipBy) return "ok";
  const ms = Date.parse(shipBy) - now.getTime();
  if (ms < 0) return "late";
  if (ms < SHIP_BY_WARNING_HOURS * 3_600_000) return "soon";
  return "ok";
}

/** eBay shippingCarrierCode values offered in the tracking form. */
export const CARRIERS = [
  { value: "USPS", label: "USPS" },
  { value: "UPS", label: "UPS" },
  { value: "FedEx", label: "FedEx" },
  { value: "DHL", label: "DHL" },
  { value: "OnTrac", label: "OnTrac" },
  { value: "Other", label: "Other" },
] as const;

export function isValidTracking(n: string): boolean {
  return /^[A-Za-z0-9-]{6,40}$/.test(n.trim());
}
