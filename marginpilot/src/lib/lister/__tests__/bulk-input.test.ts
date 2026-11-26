import { describe, expect, it } from "vitest";
import { formatLineErrors, parseCsvItems, parseLinks, parsePriceList } from "../bulk-input";

describe("parseLinks", () => {
  it("accepts supplier links and rejects retail links per line", () => {
    const r = parseLinks(
      ["https://mock-supplier.test/p/abc", "", "https://www.amazon.com/dp/B000", "mock:xyz", "mock:xyz", "https://random.example/p/1"].join("\n"),
      "mock",
    );
    expect(r.items).toEqual([
      { kind: "link", ref: "https://mock-supplier.test/p/abc" },
      { kind: "link", ref: "mock:xyz" },
    ]);
    expect(r.errors.map((e) => e.line)).toEqual([3, 5, 6]);
    expect(r.errors[0].message).toMatch(/retail store or marketplace/);
    expect(r.errors[1].message).toMatch(/Duplicate/);
  });

  it("rejects links for a different supplier adapter", () => {
    const r = parseLinks("mock:abc", "csv_feed");
    expect(r.items).toHaveLength(0);
    expect(r.errors[0].message).toMatch(/not the supplier you chose/);
  });

  it("requires at least one line", () => {
    expect(parseLinks("  \n ", "mock").errors[0].message).toMatch(/at least one/);
  });
});

describe("parseCsvItems", () => {
  it("parses valid rows and reports bad ones with line numbers", () => {
    const csv = "sku,title,cost,stock\nA1,Oak Spice Rack,12.5,10\nA2,,3,1\nA3,Glass Jar,abc,4\nA1,Dup,1,1\n";
    const r = parseCsvItems(csv);
    expect(r.items).toHaveLength(1);
    expect(r.errors.map((e) => e.line)).toEqual([3, 4, 5]);
  });

  it("requires sku, title and cost columns", () => {
    const r = parseCsvItems("name,price\nx,1");
    expect(r.errors.map((e) => e.message)).toEqual(['Missing the "sku" column.', 'Missing the "title" column.', 'Missing the "cost" column.']);
  });
});

describe("parsePriceList", () => {
  it("returns rows and caps the size", () => {
    const csv = "sku,title,cost\n" + Array.from({ length: 4 }, (_, i) => `S${i},Item ${i},${i + 1}`).join("\n");
    expect(parsePriceList(csv).rows).toHaveLength(4);
    expect(parsePriceList(csv, 3).errors[0].message).toMatch(/up to 3/);
  });
});

describe("formatLineErrors", () => {
  it("formats and truncates", () => {
    const s = formatLineErrors([{ line: 2, input: "x", message: "bad" }, { line: 0, input: "", message: "general" }], 1);
    expect(s).toBe("Line 2 (x): bad\n…and 1 more.");
  });
});
