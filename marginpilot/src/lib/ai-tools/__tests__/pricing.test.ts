import { describe, expect, it } from "vitest";
import { buildPricingPrompt, clampRecommendation, computePricingFacts, floorPrice, median, worstCaseAdRate } from "../pricing";
import { guardPrice, type GuardRules } from "@/lib/margin";

const rules: GuardRules = { finalValueFeePct: 13.6, perOrderFee: 0.4, taxOnCostPct: 0, saleDiscountPct: 0, minNetMarginPct: 20, adRateTiers: [] };
const cost = { supplierCost: 10, supplierShipping: 2 };

describe("median", () => {
  it("handles odd, even and empty", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe("floorPrice", () => {
  it("is the lowest passing price with no ad tiers", () => {
    // (12 + 0.40) / (1 - 0.336) = 18.6747 -> 18.68
    const f = floorPrice(cost, rules)!;
    expect(f).toBe(18.68);
    expect(guardPrice(f, cost, rules).ok).toBe(true);
    expect(guardPrice(f - 0.01, cost, rules).ok).toBe(false);
  });

  it("uses the worst-case ad rate of the tier the price lands in", () => {
    const tiered: GuardRules = {
      ...rules,
      adRateTiers: [
        { min_price: 0, max_price: 20, min_rate: 2, max_rate: 4 },
        { min_price: 20, max_price: null, min_rate: 5, max_rate: 10 },
      ],
    };
    expect(worstCaseAdRate(tiered)).toBe(10);
    const f = floorPrice(cost, tiered)!;
    expect(guardPrice(f, cost, tiered).ok).toBe(true);
    // 4% tier: 12.4 / (1 - 0.376) = 19.87 -> lands in the 0–20 tier, cheaper than the 10% tier price
    expect(f).toBe(19.88);
  });

  it("respects the store minimum price", () => {
    expect(floorPrice(cost, { ...rules, minPrice: 25 })).toBe(25);
  });

  it("returns null when fees + margin reach 100%", () => {
    expect(floorPrice(cost, { ...rules, minNetMarginPct: 90 })).toBeNull();
  });
});

describe("computePricingFacts", () => {
  it("computes delivered competitor median and candidates with breakdowns", () => {
    const facts = computePricingFacts({
      cost,
      rules,
      competitors: [
        { label: "A", price: 22, shipping: 0 },
        { label: "B", price: 20, shipping: 4.99 },
        { label: "C", price: 17, shipping: 0 },
      ],
      currentPrice: 24.99,
    });
    expect(facts.competitorMedian).toBe(22);
    expect(facts.competitorMin).toBe(17);
    expect(facts.competitorMax).toBe(24.99);
    expect(facts.floor).toBe(18.68);
    const prices = facts.candidates.map((c) => c.price);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
    expect(new Set(prices).size).toBe(prices.length);
    const below = facts.candidates.find((c) => c.price === 17)!;
    expect(below.ok).toBe(false);
    // 24.99 is both the current price and the highest competitor: merged into one row
    expect(facts.candidates.find((c) => c.price === 24.99)!.label).toContain("Current price");
  });
});

describe("clampRecommendation", () => {
  it("raises AI prices below the floor", () => {
    expect(clampRecommendation(15, 18.68)).toEqual({ price: 18.68, clamped: true });
  });
  it("keeps prices at or above the floor", () => {
    expect(clampRecommendation(21.499, 18.68)).toEqual({ price: 21.5, clamped: false });
  });
  it("falls back to the floor for nonsense values", () => {
    expect(clampRecommendation(Number.NaN, 18.68)).toEqual({ price: 18.68, clamped: true });
    expect(clampRecommendation(-5, 18.68)).toEqual({ price: 18.68, clamped: true });
  });
  it("returns null when there is no floor", () => {
    expect(clampRecommendation(30, null)).toBeNull();
  });
});

describe("buildPricingPrompt", () => {
  it("contains only numbers and the seller's own labels", () => {
    const comps = [{ label: "Shop X", price: 22, shipping: 0 }];
    const facts = computePricingFacts({ cost, rules, competitors: comps });
    const p = buildPricingPrompt(facts, rules, cost, comps);
    expect(p).toContain("Floor price: $18.68");
    expect(p).toContain("Shop X: $22.00");
    expect(p).not.toMatch(/ebay\.com|sold listings/i);
  });
});
