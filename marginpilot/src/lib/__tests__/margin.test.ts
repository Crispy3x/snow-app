import { describe, expect, it } from "vitest";
import { DEFAULT_FEES, adRateForPrice, computeMargin, guardPrice, priceForMargin, rulesFromRow } from "../margin";

describe("computeMargin", () => {
  it("applies 13.6% FVF and $0.40 order fee by default", () => {
    const m = computeMargin(20, { supplierCost: 10 }, DEFAULT_FEES);
    expect(m.finalValueFee).toBe(2.72);
    expect(m.perOrderFee).toBe(0.4);
    expect(m.net).toBe(6.88); // 20 - 2.72 - 0.40 - 10
    expect(m.marginPct).toBe(34.4);
  });

  it("includes ad rate, sale discount, tax on cost and supplier shipping", () => {
    const m = computeMargin(
      50,
      { supplierCost: 20, supplierShipping: 3 },
      { finalValueFeePct: 13.6, perOrderFee: 0.4, adRatePct: 5, saleDiscountPct: 10, taxOnCostPct: 8 },
    );
    // sale 45; fvf 6.12; ad 2.25; order 0.40; landed 21.60 + 3 = 24.60
    expect(m.salePrice).toBe(45);
    expect(m.finalValueFee).toBe(6.12);
    expect(m.adFee).toBe(2.25);
    expect(m.landedCost).toBe(24.6);
    expect(m.net).toBe(11.63);
    expect(m.marginPct).toBe(25.84);
  });

  it("reports a loss as negative margin", () => {
    const m = computeMargin(10, { supplierCost: 12 }, DEFAULT_FEES);
    expect(m.net).toBeLessThan(0);
    expect(m.marginPct).toBeLessThan(0);
  });

  it("rejects zero or negative prices and negative costs", () => {
    expect(() => computeMargin(0, { supplierCost: 1 }, DEFAULT_FEES)).toThrow(RangeError);
    expect(() => computeMargin(10, { supplierCost: -1 }, DEFAULT_FEES)).toThrow(RangeError);
  });

  it("uses an edited final value fee", () => {
    const m = computeMargin(100, { supplierCost: 50 }, { ...DEFAULT_FEES, finalValueFeePct: 12.35 });
    expect(m.finalValueFee).toBe(12.35);
  });
});

describe("priceForMargin", () => {
  const rules = { ...DEFAULT_FEES, adRatePct: 4, saleDiscountPct: 10 };

  it("returns a price that reaches at least the target margin", () => {
    for (const target of [10, 20, 25, 30, 40]) {
      for (const cost of [1, 7.5, 13.37, 49.99, 250]) {
        const p = priceForMargin(target, { supplierCost: cost, supplierShipping: 2 }, rules)!;
        const m = computeMargin(p, { supplierCost: cost, supplierShipping: 2 }, rules);
        expect(m.marginPct).toBeGreaterThanOrEqual(target - 0.01);
      }
    }
  });

  it("is the lowest such price to the cent", () => {
    const cost = { supplierCost: 10 };
    const p = priceForMargin(25, cost, DEFAULT_FEES)!;
    expect(computeMargin(p, cost, DEFAULT_FEES).marginPct).toBeGreaterThanOrEqual(24.995);
    expect(computeMargin(p - 0.02, cost, DEFAULT_FEES).marginPct).toBeLessThan(25);
  });

  it("charm-rounds up to .99 and never below the target", () => {
    const p = priceForMargin(25, { supplierCost: 10 }, DEFAULT_FEES, { charm: true })!;
    expect(p.toFixed(2).endsWith(".99")).toBe(true);
    expect(computeMargin(p, { supplierCost: 10 }, DEFAULT_FEES).marginPct).toBeGreaterThanOrEqual(25);
  });

  it("respects the store minimum price", () => {
    expect(priceForMargin(10, { supplierCost: 1 }, DEFAULT_FEES, { minPrice: 9.99 })).toBe(9.99);
  });

  it("returns null when fees plus margin reach 100%", () => {
    expect(priceForMargin(90, { supplierCost: 5 }, DEFAULT_FEES)).toBeNull();
  });
});

describe("adRateForPrice", () => {
  const tiers = [
    { min_price: 0, max_price: 20, min_rate: 2, max_rate: 4 },
    { min_price: 20, max_price: null, min_rate: 3, max_rate: 8 },
  ];
  it("finds the tier, with the upper bound exclusive", () => {
    expect(adRateForPrice(tiers, 19.99)).toEqual({ min: 2, max: 4 });
    expect(adRateForPrice(tiers, 20)).toEqual({ min: 3, max: 8 });
    expect(adRateForPrice(tiers, 1000)).toEqual({ min: 3, max: 8 });
  });
  it("returns zero when nothing matches", () => {
    expect(adRateForPrice([], 10)).toEqual({ min: 0, max: 0 });
  });
});

describe("guardPrice", () => {
  const rules = {
    ...DEFAULT_FEES,
    minNetMarginPct: 25,
    minPrice: 5,
    saleDiscountPct: 10,
    adRateTiers: [{ min_price: 0, max_price: null, min_rate: 2, max_rate: 6 }],
  };

  it("passes a price above the floor at the worst-case ad rate", () => {
    const r = guardPrice(40, { supplierCost: 15 }, rules);
    expect(r.ok).toBe(true);
    expect(r.breakdown.adFee).toBe(2.16); // 6% of 36
    expect(r.suggestedPrice).toBeNull();
  });

  it("blocks a price below the margin floor and suggests one that passes", () => {
    const r = guardPrice(25, { supplierCost: 15 }, rules);
    expect(r.ok).toBe(false);
    expect(r.reasons[0]).toMatch(/below the 25% floor/);
    expect(r.suggestedPrice).not.toBeNull();
    expect(guardPrice(r.suggestedPrice!, { supplierCost: 15 }, rules).ok).toBe(true);
  });

  it("blocks a price below the store minimum", () => {
    const r = guardPrice(4.5, { supplierCost: 0.5 }, { ...rules, minNetMarginPct: 0 });
    expect(r.ok).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/below the store minimum/);
  });
});

describe("rulesFromRow", () => {
  it("converts Postgres numeric strings", () => {
    const r = rulesFromRow({
      final_value_fee_pct: "13.60",
      per_order_fee: "0.40",
      tax_on_cost_pct: "0",
      sale_discount_pct: "5",
      min_net_margin_pct: "20",
      min_price: "0",
      ad_rate_tiers: null,
    });
    expect(r).toMatchObject({ finalValueFeePct: 13.6, perOrderFee: 0.4, saleDiscountPct: 5, minNetMarginPct: 20, minPrice: undefined, adRateTiers: [] });
  });
});
