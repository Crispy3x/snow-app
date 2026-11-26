/**
 * Pluggable supplier layer. Each supplier is an adapter with the same interface,
 * so the lister, monitor and order queue never care where a product comes from.
 *
 * eBay only allows drop shipping from WHOLESALE suppliers (see docs/PLAN.md §4).
 * Adapters must be wholesale sources: a mock for testing, CSV/feed import, or a
 * wholesaler's API. Retail marketplace links are rejected by isBlockedRetailUrl().
 */

export type SupplierProduct = {
  externalId: string;
  sourceUrl: string | null;
  title: string;
  description: string;
  brand: string | null;
  cost: number; // wholesale unit cost, USD
  shippingCost: number; // supplier's shipping to the buyer, USD
  stock: number;
  images: string[];
  attributes: Record<string, string>; // e.g. Color, Material, Size
  category: string | null;
};

export type StockCheck = { externalId: string; cost: number; shippingCost: number; stock: number; available: boolean };

export interface SupplierAdapter {
  /** Stored in suppliers.adapter */
  key: string;
  name: string;
  /** Can this adapter resolve the given link or reference? */
  canHandle(ref: string): boolean;
  /** Full product details from a link or reference. Throws SupplierError if not found. */
  fetchProduct(ref: string, config?: Record<string, unknown>): Promise<SupplierProduct>;
  /** Current cost and stock for many products (used by the monitor). */
  checkProducts(externalIds: string[], config?: Record<string, unknown>): Promise<StockCheck[]>;
  /** Link the seller opens to place the supplier order for an eBay sale. */
  orderUrl(externalId: string, sourceUrl: string | null): string | null;
}

export class SupplierError extends Error {
  constructor(
    message: string,
    public code: "not_found" | "blocked_retail" | "unsupported" | "unavailable",
  ) {
    super(message);
    this.name = "SupplierError";
  }
}

/** Retail marketplaces and stores. Sourcing from these for direct-to-buyer shipping breaks eBay policy. */
export const BLOCKED_RETAIL_DOMAINS = [
  "amazon.", "walmart.com", "target.com", "aliexpress.", "temu.com", "shein.com", "ebay.", "etsy.com",
  "bestbuy.com", "homedepot.com", "lowes.com", "costco.com", "kohls.com", "macys.com", "wayfair.com",
  "overstock.com", "newegg.com", "samsclub.com", "zulily.com", "wish.com", "jcpenney.com", "kmart.com",
];

export function isBlockedRetailUrl(ref: string): boolean {
  let host: string;
  try {
    host = new URL(ref).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return false;
  }
  return BLOCKED_RETAIL_DOMAINS.some((d) => (d.endsWith(".") ? host.startsWith(d) || host.includes(`.${d}`) : host === d || host.endsWith(`.${d}`)));
}
