import { describe, expect, it } from "vitest";
import { guardPrice, type GuardRules } from "@/lib/margin";
import { DEFAULT_RULES, makeSku, priceListing } from "../pricing";

const tiers: GuardRules["adRateTiers"] = [
  { min_price: 0, max_price: 20, min_rate: 2, max_rate: 4 },
  { min_price: 20, max_price: 50, min_rate: 3, max_rate: 6 },
  { min_price: 50, max_price: null, min_rate: 5, max_rate: 10 },
];

describe("priceListing", () => {
  it("prices to the floor with a .99 ending and passes the guard", () => {
    const r = priceListing(20, { supplierCost: 10, supplierShipping: 2 }, DEFAULT_RULES);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.price.toFixed(2).endsWith(".99")).toBe(true);
    expect(r.guard.breakdown.marginPct).toBeGreaterThanOrEqual(20);
  });

  it("never prices below the store floor even if the target is lower", () => {
    const r = priceListing(5, { supplierCost: 10 }, DEFAULT_RULES);
    expect(r.targetMarginPct).toBe(20);
    expect(r.ok && r.guard.breakdown.marginPct >= 20).toBe(true);
  });

  it("uses the worst-case ad rate of the price's tier", () => {
    const rules: GuardRules = { ...DEFAULT_RULES, adRateTiers: tiers };
    const r = priceListing(20, { supplierCost: 8, supplierShipping: 1 }, rules);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // guard (which applies the tier max) agrees
    expect(guardPrice(r.price, { supplierCost: 8, supplierShipping: 1 }, rules).ok).toBe(true);
    // and it's cheaper than pricing everything at the global 10% max
    const safe = priceListing(20, { supplierCost: 8, supplierShipping: 1 }, { ...DEFAULT_RULES, adRatePct: 10 });
    expect(r.price).toBeLessThan(safe.price!);
  });

  it("respects the store minimum price", () => {
    const r = priceListing(20, { supplierCost: 1 }, { ...DEFAULT_RULES, minPrice: 14.99 });
    expect(r.price).toBeGreaterThanOrEqual(14.99);
  });

  it("fails when fees plus margin reach 100%", () => {
    const r = priceListing(90, { supplierCost: 5 }, { ...DEFAULT_RULES, minNetMarginPct: 90 });
    expect(r.ok).toBe(false);
    expect(r.price).toBeNull();
  });
});

describe("makeSku", () => {
  it("is deterministic with a seed", () => {
    expect(makeSku("3f2a9c1e-aaaa-bbbb")).toBe("MP-3F2A9C1EAA");
  });
  it("is random without one", () => {
    expect(makeSku()).toMatch(/^MP-[A-Z2-9]{10}$/);
    expect(makeSku()).not.toBe(makeSku());
  });
});
