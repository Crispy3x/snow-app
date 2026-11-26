import { describe, expect, it } from "vitest";
import type { GuardRules } from "@/lib/margin";
import { pickReplacement, selectCleanupCandidates, type CleanupListing, type ReplacementProduct } from "../cleanup";

const now = new Date("2026-11-26T12:00:00Z");
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();
const l = (over: Partial<CleanupListing>): CleanupListing => ({
  id: "x",
  status: "active",
  listedAt: daysAgo(100),
  views: 0,
  sold: 0,
  price: 30,
  supplierId: "s1",
  ...over,
});

describe("selectCleanupCandidates", () => {
  const listings = [
    l({ id: "stale", listedAt: daysAgo(100) }),
    l({ id: "older", listedAt: daysAgo(200) }),
    l({ id: "young", listedAt: daysAgo(30) }),
    l({ id: "viewed", views: 3 }),
    l({ id: "sold", sold: 1 }),
    l({ id: "ended", status: "ended" }),
    l({ id: "draft", listedAt: null }),
    l({ id: "skipped" }),
  ];

  it("picks active listings older than N days with no views and no sales, oldest first", () => {
    const c = selectCleanupCandidates(listings, 90, now, new Set(["skipped"]));
    expect(c.map((x) => x.listingId)).toEqual(["older", "stale"]);
    expect(c[1]).toEqual({ listingId: "stale", ageDays: 100, reason: "Listed 100 days ago with 0 views and 0 sales." });
  });

  it("returns nothing when cleanup is off", () => {
    expect(selectCleanupCandidates(listings, 0, now)).toEqual([]);
  });
});

describe("pickReplacement", () => {
  const rules: GuardRules = { finalValueFeePct: 13.6, perOrderFee: 0.4, minNetMarginPct: 20, adRateTiers: [] };
  const p = (over: Partial<ReplacementProduct>): ReplacementProduct => ({ id: "p", supplierId: "s1", cost: 10, shippingCost: 0, stock: 10, ...over });
  const products = [
    p({ id: "cheap", cost: 8 }),
    p({ id: "cheaper-but-listed", cost: 5 }),
    p({ id: "other-supplier", supplierId: "s2", cost: 3 }),
    p({ id: "no-stock", cost: 4, stock: 0 }),
    p({ id: "mid", cost: 12 }),
    p({ id: "too-expensive", cost: 25 }),
  ];

  it("picks the in-stock, unlisted product from the same supplier with the best margin", () => {
    const r = pickReplacement({ price: 30, supplierId: "s1" }, products, new Set(["cheaper-but-listed"]), rules);
    expect(r?.productId).toBe("cheap");
  });

  it("doesn't reuse a product already suggested", () => {
    const r = pickReplacement({ price: 30, supplierId: "s1" }, products, new Set(["cheaper-but-listed"]), rules, new Set(["cheap"]));
    expect(r?.productId).toBe("mid");
  });

  it("returns null when nothing passes the floor or the listing has no supplier", () => {
    expect(pickReplacement({ price: 30, supplierId: "s1" }, [p({ cost: 25 })], new Set(), rules)).toBeNull();
    expect(pickReplacement({ price: 30, supplierId: null }, products, new Set(), rules)).toBeNull();
  });
});
