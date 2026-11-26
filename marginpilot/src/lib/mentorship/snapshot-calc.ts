import { guardPrice, type GuardRules } from "@/lib/margin";

/** Pure parts of the admin store snapshot for an audit request. Unit tested. */

export type SnapshotListing = {
  price: number | string;
  net_margin_pct: number | string | null;
  manual_cost?: number | string | null;
  manual_shipping_cost?: number | string | null;
  supplier_products: { cost: number | string | null; shipping_cost: number | string | null } | null;
};

/**
 * Listings under the store's margin floor, checked with the margin guard at the
 * worst case (highest ad tier, sale discount). Uses the supplier cost when linked,
 * then a manual cost, then the last margin the engine stored. Listings with no cost
 * information at all are counted separately as unknown.
 */
export function countLowMargin(listings: SnapshotListing[], rules: GuardRules): { low: number; unknown: number } {
  let low = 0, unknown = 0;
  for (const l of listings) {
    const price = Number(l.price);
    const sp = l.supplier_products;
    const cost = sp?.cost != null ? Number(sp.cost) : l.manual_cost != null ? Number(l.manual_cost) : null;
    const shipping = sp?.cost != null ? Number(sp.shipping_cost ?? 0) : Number(l.manual_shipping_cost ?? 0);
    if (cost !== null && price > 0 && cost >= 0) {
      if (!guardPrice(price, { supplierCost: cost, supplierShipping: shipping }, rules).ok) low++;
    } else if (l.net_margin_pct != null) {
      if (Number(l.net_margin_pct) < rules.minNetMarginPct) low++;
    } else unknown++;
  }
  return { low, unknown };
}

export type MetricRow = { day: string; sales: number | string; net_profit: number | string; orders: number };

export function sumMetrics(rows: MetricRow[]): { sales: number; net: number; orders: number; days: number } {
  let sales = 0, net = 0, orders = 0;
  for (const r of rows) {
    sales += Number(r.sales) || 0;
    net += Number(r.net_profit) || 0;
    orders += r.orders || 0;
  }
  return { sales: Math.round(sales * 100) / 100, net: Math.round(net * 100) / 100, orders, days: rows.length };
}
