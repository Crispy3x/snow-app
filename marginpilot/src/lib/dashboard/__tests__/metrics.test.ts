import { describe, expect, it } from "vitest";
import { DEFAULT_FEES } from "@/lib/margin";
import { dailyMetrics, fillSeries, lastDays, orderNet, parseTraffic, sellingLimitUsage, summarize, type MetricOrder } from "../metrics";

const order = (o: Partial<MetricOrder>): MetricOrder => ({
  status: "new",
  order_total: null,
  ebay_fees: null,
  created_on_ebay: "2026-11-20T10:00:00Z",
  created_at: "2026-11-20T10:05:00Z",
  lines: [{ quantity: 1, sale_price: 20, supplier_cost: 10 }],
  ...o,
});

describe("orderNet", () => {
  it("uses the margin engine (13.6% + $0.40) when eBay fees are unknown", () => {
    expect(orderNet(order({}), DEFAULT_FEES)).toEqual({ revenue: 20, net: 6.88 });
  });

  it("prefers eBay's actual fees and order total", () => {
    const r = orderNet(order({ order_total: "25.00", ebay_fees: "3.50" }), DEFAULT_FEES);
    expect(r).toEqual({ revenue: 25, net: 11.5 });
  });

  it("applies tax on cost and quantity", () => {
    const r = orderNet(
      order({ ebay_fees: 5, lines: [{ quantity: 2, sale_price: 15, supplier_cost: 5 }] }),
      { ...DEFAULT_FEES, taxOnCostPct: 10 },
    );
    // revenue 30, cost 2 × 5.50 = 11, fees 5
    expect(r).toEqual({ revenue: 30, net: 14 });
  });

  it("returns null net when a supplier cost is missing", () => {
    expect(orderNet(order({ lines: [{ quantity: 1, sale_price: 20, supplier_cost: null }] }), DEFAULT_FEES).net).toBeNull();
  });
});

describe("dailyMetrics", () => {
  it("groups by UTC day and excludes cancelled/returned", () => {
    const rows = dailyMetrics(
      [
        order({}),
        order({ created_on_ebay: "2026-11-20T23:59:00Z", ebay_fees: 3, order_total: 30, lines: [{ quantity: 1, sale_price: 30, supplier_cost: 12 }] }),
        order({ created_on_ebay: "2026-11-21T01:00:00Z" }),
        order({ status: "cancelled" }),
        order({ status: "returned" }),
      ],
      DEFAULT_FEES,
    );
    expect(rows.map((r) => r.day)).toEqual(["2026-11-20", "2026-11-21"]);
    expect(rows[0]).toEqual({ day: "2026-11-20", sales: 50, orders: 2, net_profit: 21.88, avg_margin_pct: 43.76 });
    expect(rows[1].orders).toBe(1);
  });

  it("leaves uncosted orders out of profit and margin but counts their sales", () => {
    const [d] = dailyMetrics([order({}), order({ lines: [{ quantity: 1, sale_price: 100, supplier_cost: null }] })], DEFAULT_FEES);
    expect(d.sales).toBe(120);
    expect(d.orders).toBe(2);
    expect(d.net_profit).toBe(6.88);
    expect(d.avg_margin_pct).toBe(34.4);
  });

  it("falls back to created_at when created_on_ebay is missing", () => {
    const [d] = dailyMetrics([order({ created_on_ebay: null, created_at: "2026-11-19T12:00:00Z" })], DEFAULT_FEES);
    expect(d.day).toBe("2026-11-19");
  });
});

describe("period helpers", () => {
  it("lastDays returns n days ending today", () => {
    expect(lastDays(3, new Date("2026-11-26T08:00:00Z"))).toEqual(["2026-11-24", "2026-11-25", "2026-11-26"]);
  });

  it("fillSeries zero-fills missing days", () => {
    const s = fillSeries([{ day: "2026-11-25", sales: "10.50", orders: 1, net_profit: "2.00", avg_margin_pct: "19.05" }], ["2026-11-24", "2026-11-25"]);
    expect(s).toEqual([
      { day: "2026-11-24", sales: 0, orders: 0, net_profit: 0 },
      { day: "2026-11-25", sales: 10.5, orders: 1, net_profit: 2 },
    ]);
  });

  it("summarize totals and weights margin by costed sales", () => {
    const s = summarize([
      { day: "a", sales: 100, orders: 2, net_profit: 20, avg_margin_pct: 20 },
      { day: "b", sales: 300, orders: 3, net_profit: 30, avg_margin_pct: 10 },
      { day: "c", sales: 50, orders: 1, net_profit: 0, avg_margin_pct: null },
    ]);
    expect(s).toEqual({ sales: 450, orders: 6, netProfit: 50, avgMarginPct: 12.5 });
    expect(summarize([]).avgMarginPct).toBeNull();
  });
});

describe("sellingLimitUsage", () => {
  it("sums price × quantity and quantity", () => {
    expect(sellingLimitUsage([{ price: "19.99", quantity: 3 }, { price: 5, quantity: 1 }])).toEqual({ amount: 64.97, quantity: 4 });
  });
});

describe("parseTraffic", () => {
  it("maps metric values by header key", () => {
    const m = parseTraffic({
      header: { metrics: [{ key: "LISTING_VIEWS_TOTAL" }, { key: "TRANSACTION" }] },
      records: [{ dimensionValues: [{ value: "1234" }], metricValues: [{ value: 40 }, { value: 2 }] }],
    });
    expect(m.get("1234")).toEqual({ LISTING_VIEWS_TOTAL: 40, TRANSACTION: 2 });
  });
});
