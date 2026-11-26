import { describe, expect, it } from "vitest";
import { chunk, rankForReview, sanitizeAuditItem, scoreListing, veroFlags, type AuditListingInput } from "../audit";
import type { GuardRules } from "@/lib/margin";

const rules: GuardRules = { finalValueFeePct: 13.6, perOrderFee: 0.4, taxOnCostPct: 0, saleDiscountPct: 0, minNetMarginPct: 20, adRateTiers: [] };

const healthy: AuditListingInput = {
  id: "a",
  title: "Stainless Steel Kitchen Utensil Set 12 Piece Silicone Heat Resistant Cooking Tools",
  price: 39.99,
  views: 400,
  sold: 5,
  watchers: 10,
  ageDays: 45,
  itemSpecificsCount: 12,
  imageCount: 9,
  supplierCost: 12,
  supplierShipping: 2,
};

describe("scoreListing", () => {
  it("gives a complete, profitable, selling listing a high score and keep", () => {
    const s = scoreListing(healthy, rules);
    expect(s.score).toBeGreaterThanOrEqual(90);
    expect(s.hint).toBe("keep");
    expect(s.metrics.marginOk).toBe(true);
    expect(s.metrics.floorPrice).not.toBeNull();
  });

  it("is deterministic", () => {
    expect(scoreListing(healthy, rules)).toEqual(scoreListing(healthy, rules));
  });

  it("penalises short titles, few photos and missing specifics", () => {
    const s = scoreListing({ ...healthy, title: "Utensil set", imageCount: 1, itemSpecificsCount: 2 }, rules);
    expect(s.parts.title).toBe(0);
    expect(s.parts.images).toBeCloseTo(1.9, 1);
    expect(s.issues).toContain("Only 1 photo");
    expect(s.issues).toContain("Only 2 item specifics");
    expect(s.hint).toBe("fix");
  });

  it("flags margin below the floor at the worst-case ad rate and hints reprice", () => {
    const s = scoreListing({ ...healthy, price: 15 }, { ...rules, adRateTiers: [{ min_price: 0, max_price: null, min_rate: 2, max_rate: 8 }] });
    expect(s.metrics.marginOk).toBe(false);
    expect(s.parts.margin).toBeLessThan(10);
    expect(s.hint).toBe("reprice");
    expect(s.issues.some((i) => i.includes("below the 20% floor"))).toBe(true);
  });

  it("treats unknown cost as neutral margin", () => {
    const s = scoreListing({ ...healthy, supplierCost: null }, rules);
    expect(s.parts.margin).toBe(10);
    expect(s.metrics.marginPct).toBeNull();
  });

  it("hints end for stale listings with no traffic", () => {
    const s = scoreListing({ ...healthy, views: 3, sold: 0, watchers: 0, ageDays: 120 }, rules);
    expect(s.hint).toBe("end");
    expect(s.parts.performance).toBeLessThan(2);
  });

  it("gives new listings a neutral performance score", () => {
    const s = scoreListing({ ...healthy, views: 0, sold: 0, watchers: 0, ageDays: 3 }, rules);
    expect(s.parts.performance).toBe(20);
  });

  it("subtracts 10 per VeRO-style flag", () => {
    const base = scoreListing(healthy, rules);
    const s = scoreListing({ ...healthy, title: healthy.title + " Nike replica" }, rules);
    expect(s.parts.brandPenalty).toBe(-20);
    expect(s.metrics.veroFlags).toHaveLength(2);
    expect(s.score).toBeLessThan(base.score);
  });

  it("keeps the score within 0..100", () => {
    const s = scoreListing({ ...healthy, title: "x replica dupe knockoff nike gucci", imageCount: 0, itemSpecificsCount: 0, views: 0, sold: 0, ageDays: 400, price: 1 }, rules);
    expect(s.score).toBe(0);
  });
});

describe("veroFlags", () => {
  it("matches whole brand words only", () => {
    expect(veroFlags("Apple Watch band")).toHaveLength(1);
    expect(veroFlags("Pineapple slicer")).toHaveLength(0);
    expect(veroFlags("Coach-style tote")).toHaveLength(1);
  });
});

describe("rankForReview / chunk", () => {
  it("picks the lowest scores, older first on ties, up to the limit", () => {
    const mk = (id: string, score: number, ageDays: number) => ({ ...scoreListing({ ...healthy, id }, rules), score, metrics: { ...scoreListing(healthy, rules).metrics, ageDays } });
    const ranked = rankForReview([mk("a", 80, 10), mk("b", 20, 10), mk("c", 20, 90), mk("d", 50, 5)], 3);
    expect(ranked.map((r) => r.listingId)).toEqual(["c", "b", "d"]);
  });
  it("chunks", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
});

describe("sanitizeAuditItem", () => {
  it("raises AI prices below the floor and trims titles", () => {
    const score = scoreListing(healthy, rules);
    const out = sanitizeAuditItem(
      { listingId: "a", recommendation: "reprice", reasons: ["r1", "r2", "r3", "r4"], suggestedTitle: "x".repeat(100), suggestedPrice: 1, notes: null },
      score,
    );
    expect(out.suggested_changes?.price).toBe(score.metrics.floorPrice);
    expect(out.suggested_changes?.title).toHaveLength(80);
    expect(out.reasons).toHaveLength(3);
  });
});
