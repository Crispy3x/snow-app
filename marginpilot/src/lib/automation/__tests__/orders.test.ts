import { beforeAll, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import type { EbayOrder } from "@/lib/ebay/api";
import { PII_RETENTION_DAYS, formatShipTo, mapEbayOrder, shipByState, type ShipTo } from "../orders";

vi.mock("server-only", () => ({}));

const fixture: EbayOrder = {
  orderId: "12-34567-89012",
  creationDate: "2026-11-20T15:30:00.000Z",
  orderFulfillmentStatus: "NOT_STARTED",
  buyer: { username: "buyer_123" },
  pricingSummary: { total: { value: "54.97", currency: "USD" } },
  totalMarketplaceFee: { value: "7.48", currency: "USD" },
  lineItems: [
    { lineItemId: "L1", sku: "SKU-A", legacyItemId: "111", title: "Garlic Press", quantity: 2, lineItemCost: { value: "39.98", currency: "USD" } },
    { lineItemId: "L2", sku: "UNKNOWN", legacyItemId: "222", title: "Other", quantity: 1, lineItemCost: { value: "14.99", currency: "USD" } },
  ],
  fulfillmentStartInstructions: [
    {
      shippingStep: {
        shipTo: {
          fullName: "Jane Buyer",
          contactAddress: { addressLine1: "1 Main St", city: "Austin", stateOrProvince: "TX", postalCode: "78701", countryCode: "US" },
          primaryPhone: { phoneNumber: "5125550100" },
        },
      },
    },
  ],
  lineItemFulfillmentInstructions: [{ shipByDate: "2026-11-23T07:59:59.000Z" }, { shipByDate: "2026-11-22T07:59:59.000Z" }],
};

const listingsBySku = new Map([["SKU-A", { id: "listing-a", supplierCost: 9.5 }]]);
const now = new Date("2026-11-21T00:00:00Z");

describe("mapEbayOrder", () => {
  let encryptJson: (v: unknown) => string;
  let decryptJson: <T>(s: string) => T;

  beforeAll(async () => {
    process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    ({ encryptJson, decryptJson } = await import("@/lib/crypto"));
  });

  it("maps the order, encrypts the ship-to and sets the purge date", () => {
    const { order } = mapEbayOrder(fixture, { orgId: "org", storeId: "store", handlingDays: 2, now, encrypt: encryptJson, listingsBySku });
    expect(order).toMatchObject({
      org_id: "org",
      store_id: "store",
      ebay_order_id: "12-34567-89012",
      status: "new",
      order_total: 54.97,
      ebay_fees: 7.48,
      buyer_username: "buyer_123",
      created_on_ebay: "2026-11-20T15:30:00.000Z",
      ship_by: "2026-11-22T07:59:59.000Z", // earliest line ship-by
    });
    expect(Date.parse(order.pii_purge_after) - Date.parse(fixture.creationDate)).toBe(PII_RETENTION_DAYS * 86_400_000);
    expect(order.ship_to_enc).toBeTruthy();
    expect(order.ship_to_enc).not.toContain("Jane");
    expect(order.ship_to_enc).not.toContain("Main");
    const shipTo = decryptJson<ShipTo>(order.ship_to_enc!);
    expect(shipTo).toEqual({
      name: "Jane Buyer",
      addressLine1: "1 Main St",
      city: "Austin",
      stateOrProvince: "TX",
      postalCode: "78701",
      countryCode: "US",
      phone: "5125550100",
    });
    expect(formatShipTo(shipTo)).toBe("Jane Buyer\n1 Main St\nAustin, TX 78701\nUS\n5125550100");
  });

  it("matches lines to listings by SKU and copies supplier cost", () => {
    const { lines } = mapEbayOrder(fixture, { orgId: "org", storeId: "store", handlingDays: 2, now, encrypt: encryptJson, listingsBySku });
    expect(lines).toEqual([
      { org_id: "org", ebay_line_item_id: "L1", listing_id: "listing-a", sku: "SKU-A", quantity: 2, sale_price: 39.98, supplier_cost: 9.5 },
      { org_id: "org", ebay_line_item_id: "L2", listing_id: null, sku: "UNKNOWN", quantity: 1, sale_price: 14.99, supplier_cost: null },
    ]);
  });

  it("falls back to handling days for ship-by and maps cancelled/fulfilled status", () => {
    const o = { ...fixture, lineItemFulfillmentInstructions: undefined, cancelStatus: { cancelState: "CANCELED" } };
    const { order } = mapEbayOrder(o, { orgId: "o", storeId: "s", handlingDays: 3, now, encrypt: encryptJson, listingsBySku });
    expect(order.ship_by).toBe("2026-11-23T15:30:00.000Z");
    expect(order.status).toBe("cancelled");
    const f = mapEbayOrder({ ...fixture, orderFulfillmentStatus: "FULFILLED" }, { orgId: "o", storeId: "s", handlingDays: 3, now, encrypt: encryptJson, listingsBySku });
    expect(f.order.status).toBe("shipped");
  });

  it("never stores ship-to for an order already past its retention date", () => {
    const later = new Date(Date.parse(fixture.creationDate) + (PII_RETENTION_DAYS + 1) * 86_400_000);
    const encrypt = vi.fn(() => "x");
    const { order } = mapEbayOrder(fixture, { orgId: "o", storeId: "s", handlingDays: 2, now: later, encrypt, listingsBySku });
    expect(order.ship_to_enc).toBeNull();
    expect(encrypt).not.toHaveBeenCalled();
  });
});

describe("shipByState", () => {
  it("warns when ship-by is within 24 hours or past", () => {
    expect(shipByState("2026-11-21T12:00:00Z", now)).toBe("soon");
    expect(shipByState("2026-11-20T12:00:00Z", now)).toBe("late");
    expect(shipByState("2026-11-25T12:00:00Z", now)).toBe("ok");
    expect(shipByState(null, now)).toBe("ok");
  });
});
