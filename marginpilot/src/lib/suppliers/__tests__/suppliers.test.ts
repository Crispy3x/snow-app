import { describe, expect, it } from "vitest";
import { isBlockedRetailUrl, resolveAdapter } from "../index";
import { mockProduct, mockSupplier } from "../mock";
import { parseCsv, rowToProduct } from "../csv";

describe("retail link blocking", () => {
  it.each(["https://www.amazon.com/dp/B000", "https://amazon.co.uk/x", "https://www.walmart.com/ip/1", "https://aliexpress.us/item/1", "https://m.aliexpress.com/x", "https://www.ebay.com/itm/1"])(
    "blocks %s",
    (url) => expect(isBlockedRetailUrl(url)).toBe(true),
  );
  it.each(["https://mock-supplier.test/p/1", "https://wholesale-example.com/item/2", "mock:abc"])("allows %s", (url) =>
    expect(isBlockedRetailUrl(url)).toBe(false),
  );
  it("resolveAdapter refuses retail links with a clear reason", () => {
    expect(() => resolveAdapter("https://www.amazon.com/dp/B000")).toThrow(/wholesale/);
  });
});

describe("mock supplier", () => {
  it("is deterministic for an id and day", () => {
    const d = new Date("2026-12-01T12:00:00Z");
    expect(mockProduct("abc", d)).toEqual(mockProduct("abc", d));
  });
  it("handles out-of-stock and missing products", async () => {
    expect((await mockSupplier.fetchProduct("mock:oos-1")).stock).toBe(0);
    await expect(mockSupplier.fetchProduct("mock:gone-1")).rejects.toThrow(/not found/);
    const [c] = await mockSupplier.checkProducts(["gone-1"]);
    expect(c.available).toBe(false);
  });
  it("resolves both link styles", () => {
    expect(resolveAdapter("https://mock-supplier.test/p/xyz").key).toBe("mock");
    expect(resolveAdapter("mock:xyz").key).toBe("mock");
  });
});

describe("csv supplier", () => {
  it("parses quoted cells and extra columns as item specifics", () => {
    const rows = parseCsv('sku,title,cost,stock,color\nA1,"Mug, 12oz",3.5,10,Blue\n');
    expect(rows).toEqual([{ sku: "A1", title: "Mug, 12oz", cost: "3.5", stock: "10", color: "Blue" }]);
    const p = rowToProduct(rows[0]);
    expect(p.cost).toBe(3.5);
    expect(p.attributes).toEqual({ Color: "Blue" });
  });
  it("rejects rows without cost", () => {
    expect(() => rowToProduct({ sku: "A", title: "B", cost: "" })).toThrow();
  });
});
