import { describe, expect, it, vi } from "vitest";
import { reverseEntry, undoBlockReason, type ActivityRow, type UndoDeps, type UndoListing } from "../undo";

const listing: UndoListing = {
  id: "L1",
  sku: "SKU-1",
  ebay_offer_id: "OFF-1",
  ebay_listing_id: "EB-1",
  price: 24.99,
  quantity: 0,
  status: "out_of_stock",
};

function mockDeps(over: Partial<UndoDeps> = {}) {
  const ebay = {
    updatePriceQuantity: vi.fn(async () => {}),
    publishOffer: vi.fn(async () => ({ listingId: "EB-NEW" })),
    withdrawOffer: vi.fn(async () => undefined),
    getInventoryItem: vi.fn(async () => ({
      availability: { shipToLocationAvailability: { quantity: 3 } },
      condition: "NEW" as const,
      product: { title: "New title", description: "d", aspects: { Color: ["Black"] }, imageUrls: ["https://x/1.jpg"] },
    })),
    putInventoryItem: vi.fn(async () => {}),
    updateAdBid: vi.fn(async () => {}),
  };
  const deps: UndoDeps = {
    ebay,
    loadListing: vi.fn(async () => listing),
    updateListing: vi.fn(async () => {}),
    checkFloor: vi.fn(async () => ({ ok: true, reasons: [] })),
    ...over,
  };
  return { deps, ebay };
}

const entry = (over: Partial<ActivityRow>): ActivityRow => ({
  id: 1,
  org_id: "org",
  store_id: "store",
  actor: "automation",
  entity_type: "listing",
  entity_id: "L1",
  action: "price_changed",
  before: null,
  after: null,
  undoable: true,
  undone_at: null,
  undo_of: null,
  ...over,
});

describe("reverseEntry", () => {
  it("price_changed sets the old price back", async () => {
    const { deps, ebay } = mockDeps();
    const r = await reverseEntry(entry({ action: "price_changed", before: { price: 19.99 } }), deps);
    expect(r).toMatchObject({ ok: true, after: { price: 19.99 } });
    expect(ebay.updatePriceQuantity).toHaveBeenCalledWith({ sku: "SKU-1", offerId: "OFF-1", price: 19.99 });
    expect(deps.updateListing).toHaveBeenCalledWith("L1", { price: 19.99 });
  });

  it("price_changed warns (but still restores) when the old price is below the floor", async () => {
    const { deps } = mockDeps({ checkFloor: vi.fn(async () => ({ ok: false, reasons: ["Net margin 12% is below the 20% floor."] })) });
    const r = await reverseEntry(entry({ action: "price_changed", before: { price: 19.99 } }), deps);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warning).toMatch(/below the margin floor/);
  });

  it("quantity_set restores quantity and status", async () => {
    const { deps, ebay } = mockDeps();
    const r = await reverseEntry(entry({ action: "quantity_set", before: { quantity: 5, status: "active" } }), deps);
    expect(r.ok).toBe(true);
    expect(ebay.updatePriceQuantity).toHaveBeenCalledWith({ sku: "SKU-1", offerId: "OFF-1", quantity: 5 });
    expect(deps.updateListing).toHaveBeenCalledWith("L1", { quantity: 5, status: "active", restock_quantity: null });
  });

  it("listing_ended publishes the offer again", async () => {
    const { deps, ebay } = mockDeps();
    const r = await reverseEntry(entry({ action: "listing_ended", before: { status: "active", offerId: "OFF-1" } }), deps);
    expect(r.ok).toBe(true);
    expect(ebay.publishOffer).toHaveBeenCalledWith("OFF-1");
    expect(deps.updateListing).toHaveBeenCalledWith("L1", { status: "active", ebay_listing_id: "EB-NEW", ended_at: null });
  });

  it("title_changed fetches the current item and puts it back with the old title", async () => {
    const { deps, ebay } = mockDeps();
    const r = await reverseEntry(entry({ action: "title_changed", before: { title: "Old title" } }), deps);
    expect(r).toMatchObject({ ok: true, before: { title: "New title" }, after: { title: "Old title" } });
    expect(ebay.getInventoryItem).toHaveBeenCalledWith("SKU-1");
    expect(ebay.putInventoryItem).toHaveBeenCalledWith(
      "SKU-1",
      expect.objectContaining({
        condition: "NEW",
        availability: { shipToLocationAvailability: { quantity: 3 } },
        product: expect.objectContaining({ title: "Old title", aspects: { Color: ["Black"] } }),
      }),
    );
  });

  it("ad_bid_changed restores the bid", async () => {
    const { deps, ebay } = mockDeps();
    const r = await reverseEntry(
      entry({ action: "ad_bid_changed", before: { bidPct: 3.5, campaignId: "C1", ebayListingId: "EB-1" }, after: { bidPct: 5 } }),
      deps,
    );
    expect(r).toMatchObject({ ok: true, before: { bidPct: 5 }, after: { bidPct: 3.5 } });
    expect(ebay.updateAdBid).toHaveBeenCalledWith("C1", "EB-1", 3.5);
  });

  it("refuses entries that aren't undoable, already undone, or undos themselves, without calling eBay", async () => {
    const { deps, ebay } = mockDeps();
    const sent = await reverseEntry(entry({ action: "offer_sent", undoable: false }), deps);
    expect(sent).toEqual({ ok: false, message: "eBay doesn't allow cancelling an offer that was already sent to buyers." });
    expect((await reverseEntry(entry({ undone_at: "2026-11-01T00:00:00Z", before: { price: 1 } }), deps)).ok).toBe(false);
    expect((await reverseEntry(entry({ undo_of: 7, before: { price: 1 } }), deps)).ok).toBe(false);
    expect(Object.values(ebay).every((f) => f.mock.calls.length === 0)).toBe(true);
  });

  it("fails cleanly when the old value is missing", async () => {
    const { deps, ebay } = mockDeps();
    const r = await reverseEntry(entry({ action: "price_changed", before: {} }), deps);
    expect(r).toEqual({ ok: false, message: "The old price wasn't recorded." });
    expect(ebay.updatePriceQuantity).not.toHaveBeenCalled();
  });
});

describe("undoBlockReason", () => {
  it("explains why entries can't be undone", () => {
    expect(undoBlockReason({ action: "tracking_posted", undoable: false, undone_at: null, undo_of: null })).toMatch(/Tracking/);
    expect(undoBlockReason({ action: "something_else", undoable: false, undone_at: null, undo_of: null })).toMatch(/can't be reversed/);
    expect(undoBlockReason({ action: "price_changed", undoable: true, undone_at: null, undo_of: null })).toBeNull();
  });
});

describe("lister actions", () => {
  it("listing_published withdraws the offer", async () => {
    const { deps, ebay } = mockDeps({ loadListing: vi.fn(async () => ({ ...listing, status: "active" })) });
    const r = await reverseEntry(entry({ action: "listing_published", after: { offer_id: "OFF-9" } }), deps);
    expect(r.ok).toBe(true);
    expect(ebay.withdrawOffer).toHaveBeenCalledWith("OFF-9");
    expect(deps.updateListing).toHaveBeenCalledWith("L1", expect.objectContaining({ status: "ended" }));
  });

  it("listing_edited restores price, quantity and title on a live listing", async () => {
    const { deps, ebay } = mockDeps({ loadListing: vi.fn(async () => ({ ...listing, status: "active" })) });
    const r = await reverseEntry(entry({ action: "listing_edited", before: { price: 21, quantity: 4, title: "Old" }, after: { price: 25 } }), deps);
    expect(r.ok).toBe(true);
    expect(ebay.updatePriceQuantity).toHaveBeenCalledWith({ sku: "SKU-1", offerId: "OFF-1", price: 21, quantity: 4 });
    expect(ebay.putInventoryItem).toHaveBeenCalledWith("SKU-1", expect.objectContaining({ product: expect.objectContaining({ title: "Old" }) }));
    expect(deps.updateListing).toHaveBeenCalledWith("L1", { price: 21, quantity: 4, title: "Old" });
  });
});

