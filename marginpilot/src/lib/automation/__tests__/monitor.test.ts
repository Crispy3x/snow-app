import { describe, expect, it } from "vitest";
import { guardPrice } from "@/lib/margin";
import { decideListing, type MonitorListing, type MonitorRules } from "../monitor";

const rules = (over: Partial<MonitorRules> = {}): MonitorRules => ({
  finalValueFeePct: 13.6,
  perOrderFee: 0.4,
  taxOnCostPct: 0,
  saleDiscountPct: 0,
  minNetMarginPct: 20,
  adRateTiers: [],
  monitorAction: "reprice",
  repriceRequiresApproval: true,
  ...over,
});

// $30 list, $15 cost: margin = (30 - 4.08 - 0.40 - 15) / 30 = 34.9%
const listing = (over: Partial<MonitorListing> = {}): MonitorListing => ({
  price: 30,
  quantity: 5,
  status: "active",
  restockQuantity: null,
  oldCost: 15,
  oldShipping: 0,
  ...over,
});
const inStock = (cost = 15, stock = 50) => ({ available: true, stock, cost, shippingCost: 0 });

describe("decideListing: stock", () => {
  it("sets quantity 0 when the supplier drops the product", () => {
    const d = decideListing(listing(), null, rules());
    expect(d).toEqual([expect.objectContaining({ type: "set_out_of_stock", quantity: 0, restockQuantity: 5 })]);
    expect(d[0].reason).toMatch(/no longer lists/);
  });

  it("sets quantity 0 when the supplier is out of stock or unavailable", () => {
    expect(decideListing(listing(), { ...inStock(), stock: 0 }, rules())[0].type).toBe("set_out_of_stock");
    expect(decideListing(listing(), { ...inStock(), available: false }, rules())[0].type).toBe("set_out_of_stock");
  });

  it("does nothing when the listing is already out of stock and the supplier still is", () => {
    expect(decideListing(listing({ status: "out_of_stock", quantity: 0 }), null, rules())).toEqual([]);
  });

  it("restores min(stock, previous quantity) when stock is back", () => {
    const d = decideListing(listing({ status: "out_of_stock", quantity: 0, restockQuantity: 8 }), inStock(15, 3), rules());
    expect(d).toEqual([expect.objectContaining({ type: "restore_stock", quantity: 3 })]);
    const d2 = decideListing(listing({ status: "out_of_stock", quantity: 0, restockQuantity: 8 }), inStock(15, 50), rules());
    expect(d2[0]).toMatchObject({ type: "restore_stock", quantity: 8 });
  });

  it("restores 1 when the previous quantity is unknown", () => {
    const d = decideListing(listing({ status: "out_of_stock", quantity: 0 }), inStock(), rules());
    expect(d[0]).toMatchObject({ type: "restore_stock", quantity: 1 });
  });

  it("does nothing when cost and stock are unchanged", () => {
    expect(decideListing(listing(), inStock(), rules())).toEqual([]);
  });

  it("ignores cost when no previous cost was recorded", () => {
    expect(decideListing(listing({ oldCost: null }), inStock(25), rules())).toEqual([]);
  });

  it("ignores small cost moves that stay within floor..floor+buffer", () => {
    expect(decideListing(listing(), inStock(16), rules())).toEqual([]);
  });
});

describe("decideListing: cost up (margin below floor)", () => {
  it("proposes a higher price when approval is required", () => {
    const d = decideListing(listing(), inStock(22), rules());
    expect(d).toHaveLength(1);
    const r = d[0];
    expect(r.type).toBe("reprice");
    if (r.type !== "reprice") return;
    expect(r.mode).toBe("propose");
    expect(r.newPrice).toBeGreaterThan(30);
    expect(r.marginBefore).toBeLessThan(20);
    expect(r.marginAfter).toBeGreaterThanOrEqual(20);
    expect(guardPrice(r.newPrice, { supplierCost: 22 }, rules()).ok).toBe(true);
    expect(r.reason).toMatch(/\$15\.00 to \$22\.00/);
  });

  it("applies the new price when approval is off", () => {
    const d = decideListing(listing(), inStock(22), rules({ repriceRequiresApproval: false }));
    expect(d[0]).toMatchObject({ type: "reprice", mode: "apply" });
  });

  it("prices at the worst-case ad rate for the tier", () => {
    const tiers = [{ min_price: 0, max_price: null, min_rate: 2, max_rate: 8 }];
    const r = decideListing(listing(), inStock(22), rules({ adRateTiers: tiers }))[0];
    if (r.type !== "reprice") throw new Error("expected reprice");
    expect(guardPrice(r.newPrice, { supplierCost: 22 }, rules({ adRateTiers: tiers })).ok).toBe(true);
    const noAds = decideListing(listing(), inStock(22), rules())[0];
    if (noAds.type !== "reprice") throw new Error("expected reprice");
    expect(r.newPrice).toBeGreaterThan(noAds.newPrice);
  });

  it("sets out of stock when monitor_action is out_of_stock", () => {
    const d = decideListing(listing(), inStock(22), rules({ monitorAction: "out_of_stock" }));
    expect(d).toEqual([expect.objectContaining({ type: "set_out_of_stock", restockQuantity: 5 })]);
  });

  it("flags with a suggested price when monitor_action is flag", () => {
    const d = decideListing(listing(), inStock(22), rules({ monitorAction: "flag" }));
    expect(d[0]).toMatchObject({ type: "flag" });
    if (d[0].type === "flag") expect(d[0].proposedPrice).toBeGreaterThan(30);
  });

  it("flags when no price can reach the floor", () => {
    const d = decideListing(listing(), inStock(22), rules({ minNetMarginPct: 90 }));
    expect(d[0]).toMatchObject({ type: "flag", proposedPrice: null });
    expect(d[0].reason).toMatch(/No price reaches/);
  });

  it("keeps an out-of-stock listing off sale until a proposed price is approved", () => {
    const d = decideListing(listing({ status: "out_of_stock", quantity: 0, restockQuantity: 4 }), inStock(22), rules());
    expect(d.map((x) => x.type)).toEqual(["reprice"]);
  });

  it("restocks together with an automatically applied price", () => {
    const d = decideListing(
      listing({ status: "out_of_stock", quantity: 0, restockQuantity: 4 }),
      inStock(22),
      rules({ repriceRequiresApproval: false }),
    );
    expect(d.map((x) => x.type)).toEqual(["reprice", "restore_stock"]);
  });

  it("does not restock when monitor_action is out_of_stock and the margin is below floor", () => {
    const d = decideListing(listing({ status: "out_of_stock", quantity: 0 }), inStock(22), rules({ monitorAction: "out_of_stock" }));
    expect(d).toEqual([]);
  });
});

describe("decideListing: cost down (margin above floor + buffer)", () => {
  it("proposes a lower price that still passes the floor", () => {
    const r = decideListing(listing(), inStock(8), rules())[0];
    if (r.type !== "reprice") throw new Error("expected reprice");
    expect(r.newPrice).toBeLessThan(30);
    expect(r.marginBefore).toBeGreaterThan(35);
    expect(guardPrice(r.newPrice, { supplierCost: 8 }, rules()).ok).toBe(true);
  });

  it("flags instead of repricing for monitor_action flag and out_of_stock", () => {
    expect(decideListing(listing(), inStock(8), rules({ monitorAction: "flag" }))[0].type).toBe("flag");
    expect(decideListing(listing(), inStock(8), rules({ monitorAction: "out_of_stock" }))[0].type).toBe("flag");
  });

  it("treats a shipping change as a cost change", () => {
    const d = decideListing(listing(), { ...inStock(15), shippingCost: 8 }, rules());
    expect(d[0].type).toBe("reprice");
  });
});
