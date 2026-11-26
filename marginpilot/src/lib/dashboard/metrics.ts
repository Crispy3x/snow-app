import { computeMargin, landedCost, type FeeRules } from "@/lib/margin";

/**
 * Dashboard metric calculations. Pure functions, unit tested.
 *
 * Per order:
 *   revenue = order_total when eBay gave one, else Σ sale_price × quantity
 *   fees    = ebay_fees (eBay's actual marketplace fee) when present,
 *             else the store's rules (final value fee % + per-order fee) via the margin engine
 *   cost    = Σ landedCost(supplier_cost) × quantity (tax on cost from the store rules)
 *   net     = revenue − fees − cost
 * Orders with any line missing supplier_cost count towards sales and order
 * count but not towards net profit or margin (we don't guess costs).
 * Cancelled and returned orders are excluded entirely.
 */

export type MetricOrder = {
  status: string;
  order_total: number | string | null;
  ebay_fees: number | string | null;
  created_on_ebay: string | null;
  created_at: string;
  lines: { quantity: number; sale_price: number | string; supplier_cost: number | string | null }[];
};

export type DayMetrics = { day: string; sales: number; orders: number; net_profit: number; avg_margin_pct: number | null };

const EXCLUDED = new Set(["cancelled", "returned"]);
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const num = (v: number | string | null | undefined) => (v === null || v === undefined || v === "" ? null : Number(v));

export function orderDay(o: Pick<MetricOrder, "created_on_ebay" | "created_at">): string {
  return new Date(o.created_on_ebay ?? o.created_at).toISOString().slice(0, 10);
}

/** Revenue and net for one order; net is null when a supplier cost is missing. */
export function orderNet(o: MetricOrder, rules: FeeRules): { revenue: number; net: number | null } {
  const lineRevenue = o.lines.reduce((s, l) => s + Number(l.sale_price) * l.quantity, 0);
  const revenue = num(o.order_total) ?? lineRevenue;
  if (o.lines.length === 0 || o.lines.some((l) => num(l.supplier_cost) === null)) return { revenue: round2(revenue), net: null };
  const cost = o.lines.reduce((s, l) => s + landedCost({ supplierCost: Number(l.supplier_cost) }, rules) * l.quantity, 0);
  const fees = num(o.ebay_fees);
  if (fees !== null) return { revenue: round2(revenue), net: round2(revenue - fees - cost) };
  if (!(revenue > 0)) return { revenue: 0, net: round2(-cost) };
  // Sale price is what the buyer actually paid, so no ad rate or sale discount on top.
  const m = computeMargin(revenue, { supplierCost: cost }, { ...rules, adRatePct: 0, saleDiscountPct: 0, taxOnCostPct: 0 });
  return { revenue: round2(revenue), net: m.net };
}

/** Group orders into per-day metrics. avg_margin_pct = Σ net ÷ Σ revenue over orders with known costs. */
export function dailyMetrics(orders: MetricOrder[], rules: FeeRules): DayMetrics[] {
  const days = new Map<string, { sales: number; orders: number; net: number; costedRevenue: number }>();
  for (const o of orders) {
    if (EXCLUDED.has(o.status)) continue;
    const day = orderDay(o);
    const d = days.get(day) ?? { sales: 0, orders: 0, net: 0, costedRevenue: 0 };
    const { revenue, net } = orderNet(o, rules);
    d.sales += revenue;
    d.orders += 1;
    if (net !== null) {
      d.net += net;
      d.costedRevenue += revenue;
    }
    days.set(day, d);
  }
  return [...days.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, d]) => ({
      day,
      sales: round2(d.sales),
      orders: d.orders,
      net_profit: round2(d.net),
      avg_margin_pct: d.costedRevenue > 0 ? round2((d.net / d.costedRevenue) * 100) : null,
    }));
}

/** The last `n` UTC days ending today, oldest first, as YYYY-MM-DD. */
export function lastDays(n: number, today = new Date()): string[] {
  const end = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Array.from({ length: n }, (_, i) => new Date(end - (n - 1 - i) * 86_400_000).toISOString().slice(0, 10));
}

export type StoredDay = {
  day: string;
  sales: number | string;
  orders: number;
  net_profit: number | string;
  avg_margin_pct: number | string | null;
};

/** Every day in the period, zero-filled, for charts. */
export function fillSeries(rows: StoredDay[], days: string[]) {
  const byDay = new Map(rows.map((r) => [r.day, r]));
  return days.map((day) => {
    const r = byDay.get(day);
    return { day, sales: Number(r?.sales ?? 0), orders: r?.orders ?? 0, net_profit: Number(r?.net_profit ?? 0) };
  });
}

/** Period totals. Average margin is profit-weighted by sales on days with a margin. */
export function summarize(rows: StoredDay[]) {
  let sales = 0;
  let orders = 0;
  let net = 0;
  let marginSales = 0;
  let marginNet = 0;
  for (const r of rows) {
    sales += Number(r.sales);
    orders += r.orders;
    net += Number(r.net_profit);
    if (r.avg_margin_pct !== null && r.avg_margin_pct !== undefined) {
      const pct = Number(r.avg_margin_pct);
      if (pct !== 0) {
        marginNet += Number(r.net_profit);
        marginSales += Number(r.net_profit) / (pct / 100);
      } else {
        marginSales += Number(r.sales);
      }
    }
  }
  return {
    sales: round2(sales),
    orders,
    netProfit: round2(net),
    avgMarginPct: marginSales > 0 ? round2((marginNet / marginSales) * 100) : null,
  };
}

/** Selling-limit usage from active listings: amount = Σ price × quantity, quantity = Σ quantity. */
export function sellingLimitUsage(listings: { price: number | string; quantity: number }[]) {
  return listings.reduce(
    (acc, l) => ({ amount: round2(acc.amount + Number(l.price) * l.quantity), quantity: acc.quantity + l.quantity }),
    { amount: 0, quantity: 0 },
  );
}

/**
 * Parses an Analytics traffic report into {key → metric values by name}.
 * Records carry dimension values (listing id or day) and metric values in header order.
 */
export function parseTraffic(report: {
  records?: { dimensionValues: { value: string }[]; metricValues: { value: number }[] }[];
  header?: { metrics?: { key: string }[] };
}): Map<string, Record<string, number>> {
  const keys = report.header?.metrics?.map((m) => m.key) ?? [];
  const out = new Map<string, Record<string, number>>();
  for (const r of report.records ?? []) {
    const id = r.dimensionValues?.[0]?.value;
    if (!id) continue;
    const vals: Record<string, number> = {};
    keys.forEach((k, i) => (vals[k] = Number(r.metricValues?.[i]?.value ?? 0)));
    out.set(id, vals);
  }
  return out;
}
