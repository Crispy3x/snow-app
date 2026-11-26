import { describe, expect, it } from "vitest";
import { calculate, CALCULATOR_DEFAULTS, parseNumber } from "../math";
import { computeMargin } from "@/lib/margin";

describe("parseNumber", () => {
  it("accepts friendly formats and rejects junk", () => {
    expect(parseNumber(" $1,299.50 ")).toBe(1299.5);
    expect(parseNumber("13.6%")).toBe(13.6);
    expect(parseNumber(".5")).toBe(0.5);
    expect(parseNumber("12.")).toBe(12);
    expect(parseNumber("")).toBeNull();
    expect(Number.isNaN(parseNumber("12abc"))).toBe(true);
    expect(Number.isNaN(parseNumber("1.2.3"))).toBe(true);
  });
});

describe("calculate", () => {
  it("matches the margin engine for the defaults", () => {
    const r = calculate(CALCULATOR_DEFAULTS);
    if (!r.ok) throw new Error("expected ok");
    const expected = computeMargin(29.99, { supplierCost: 9.5, supplierShipping: 3 }, { finalValueFeePct: 13.6, perOrderFee: 0.4, adRatePct: 0, saleDiscountPct: 0, taxOnCostPct: 0 });
    expect(r.breakdown).toEqual(expected);
    // 29.99 - (4.08 + 0.40) - 12.50 = 13.01
    expect(r.breakdown.net).toBeCloseTo(13.01, 2);
    expect(r.discount).toBe(0);
  });

  it("applies ad rate, sale discount and tax on cost, and prices for the target", () => {
    const r = calculate({ ...CALCULATOR_DEFAULTS, salePrice: "40", adRatePct: "5", saleDiscountPct: "10", taxOnCostPct: "8", targetMarginPct: "20" });
    if (!r.ok) throw new Error("expected ok");
    expect(r.breakdown.salePrice).toBe(36);
    expect(r.discount).toBe(4);
    expect(r.breakdown.adFee).toBe(1.8);
    expect(r.breakdown.landedCost).toBe(13.26);
    expect(r.priceForTarget).not.toBeNull();
    // The suggested price really reaches the target.
    const check = calculate({ ...CALCULATOR_DEFAULTS, salePrice: String(r.priceForTarget), adRatePct: "5", saleDiscountPct: "10", taxOnCostPct: "8" });
    if (!check.ok) throw new Error("expected ok");
    expect(check.breakdown.marginPct).toBeGreaterThanOrEqual(19.99);
  });

  it("returns null price when fees plus target reach 100%", () => {
    const r = calculate({ ...CALCULATOR_DEFAULTS, finalValueFeePct: "60", targetMarginPct: "45" });
    expect(r.ok && r.priceForTarget).toBeNull();
  });

  it("reports field errors instead of throwing", () => {
    const r = calculate({ ...CALCULATOR_DEFAULTS, salePrice: "0", itemCost: "", adRatePct: "abc", finalValueFeePct: "150" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(Object.keys(r.errors).sort()).toEqual(["adRatePct", "finalValueFeePct", "itemCost", "salePrice"]);
  });

  it("treats empty optional fields as 0", () => {
    const r = calculate({ ...CALCULATOR_DEFAULTS, supplierShipping: "", adRatePct: "", saleDiscountPct: "", taxOnCostPct: "" });
    expect(r.ok).toBe(true);
  });
});
