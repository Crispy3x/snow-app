import { describe, expect, it } from "vitest";
import { guardPrice, type GuardRules } from "@/lib/margin";
import { computeOfferPrice } from "../offers";

const rules: GuardRules = { finalValueFeePct: 13.6, perOrderFee: 0.4, saleDiscountPct: 10, minNetMarginPct: 20, adRateTiers: [] };

describe("computeOfferPrice", () => {
  it("prices for the target margin with no sale discount and passes the floor", () => {
    const q = computeOfferPrice({ targetMarginPct: 22, currentPrice: 40, cost: { supplierCost: 15 }, rules });
    expect(q.ok).toBe(true);
    if (!q.ok) return;
    // (15 + 0.40) / (1 - 0.136 - 0.22) = 23.913 -> 23.92
    expect(q.price).toBe(23.92);
    expect(q.price).toBeLessThan(40);
    expect(q.marginPct).toBeGreaterThanOrEqual(22);
    expect(guardPrice(q.price, { supplierCost: 15 }, { ...rules, saleDiscountPct: 0 }).ok).toBe(true);
    expect(q.discountPct).toBeCloseTo(40.2, 1);
  });

  it("uses the worst-case ad rate of the resulting tier", () => {
    const tiers = [{ min_price: 0, max_price: null, min_rate: 2, max_rate: 6 }];
    const q = computeOfferPrice({ targetMarginPct: 22, currentPrice: 40, cost: { supplierCost: 15 }, rules: { ...rules, adRateTiers: tiers } });
    if (!q.ok) throw new Error(q.reason);
    expect(q.price).toBeGreaterThan(23.92);
    expect(q.marginPct).toBeGreaterThanOrEqual(22);
  });

  it("rejects an offer that isn't below the current price", () => {
    const q = computeOfferPrice({ targetMarginPct: 25, currentPrice: 20, cost: { supplierCost: 15 }, rules });
    expect(q).toMatchObject({ ok: false });
    if (!q.ok) expect(q.reason).toMatch(/not be below/);
  });

  it("rejects a target below the store floor", () => {
    const q = computeOfferPrice({ targetMarginPct: 10, currentPrice: 40, cost: { supplierCost: 15 }, rules });
    expect(q).toMatchObject({ ok: false });
    if (!q.ok) expect(q.reason).toMatch(/floor/);
  });

  it("rejects an impossible target", () => {
    const q = computeOfferPrice({ targetMarginPct: 90, currentPrice: 400, cost: { supplierCost: 15 }, rules: { ...rules, minNetMarginPct: 20 } });
    expect(q).toMatchObject({ ok: false, price: null });
  });

  it("respects the store minimum price", () => {
    const q = computeOfferPrice({ targetMarginPct: 20, currentPrice: 40, cost: { supplierCost: 5 }, rules: { ...rules, minPrice: 15 } });
    if (!q.ok) throw new Error(q.reason);
    expect(q.price).toBe(15);
  });
});
