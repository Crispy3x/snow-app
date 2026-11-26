import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/ai/run", () => ({ runAi: vi.fn() }));

const { buildListingRow, finishPhotoDraft, floorPrice, parseSpecifics } = await import("../draft");
const { DEFAULT_RULES } = await import("@/lib/lister/pricing");

const rules = { ...DEFAULT_RULES, minNetMarginPct: 20 };
const base = {
  id: "00000000-0000-4000-8000-000000000001",
  orgId: "org-1",
  storeId: "store-1",
  sku: "MP-TEST",
  images: ["https://example.supabase.co/storage/v1/object/sign/a.jpg?token=x", "http://insecure/b.jpg"],
  rules,
};

describe("photo draft post-processing", () => {
  it("sanitises the model output and merges VeRO with the code check", () => {
    const d = finishPhotoDraft({
      productSummary: "A red water bottle",
      title: "HOT SALE Stanley Style Insulated Bottle!!! FREE SHIPPING",
      description: "<p>Keeps drinks cold. Visit www.shop.com</p>",
      itemSpecifics: [{ name: "Color", values: ["Red"] }],
      categoryKeywords: ["water bottle", " water bottle ", "insulated bottle"],
      condition: "New",
      conditionNotes: "",
      vero: { risk: "none", brandsMentioned: [], reasons: [] },
    });
    expect(d.title).toBe("Stanley Style Insulated Bottle");
    expect(d.description).not.toMatch(/www/);
    expect(d.itemSpecifics).toEqual({ Color: ["Red"], Brand: ["Unbranded"] });
    expect(d.categoryKeywords).toEqual(["water bottle", "insulated bottle"]);
    expect(d.vero.risk).not.toBe("none");
    expect(d.vero.brandsMentioned).toContain("stanley");
  });

  it("parses item specifics from lines and JSON", () => {
    expect(parseSpecifics("Material: Steel, Steel\nColor: Red, Blue\nnot a line\n: empty")).toEqual({ Material: ["Steel"], Color: ["Red", "Blue"] });
    expect(parseSpecifics('{"Brand":["Unbranded"],"Bad":"x"}')).toEqual({ Brand: ["Unbranded"] });
  });

  it("prices at the margin floor only when a cost is known", () => {
    expect(floorPrice(null, null, rules).price).toBeNull();
    const f = floorPrice(10, 3, rules);
    expect(f.price).toBeGreaterThan(13);
    expect(String(f.price)).toMatch(/\.99$/);
  });
});

describe("draft to listing mapping", () => {
  const input = { title: "Stainless Steel Garlic Press Kitchen Tool", description: "<p>Crushes garlic.</p>", specifics: { Brand: ["Unbranded"] }, price: null, cost: 8, shipping: 2, quantity: 3 };

  it("fills the floor price and passes the guard when price is blank", () => {
    const r = buildListingRow({ ...base, input });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.price).toBe(floorPrice(8, 2, rules).price);
    expect(r.guard?.ok).toBe(true);
    expect(r.row).toMatchObject({
      id: base.id,
      org_id: "org-1",
      store_id: "store-1",
      sku: "MP-TEST",
      status: "draft",
      quantity: 3,
      manual_cost: 8,
      manual_shipping_cost: 2,
      margin_reasons: [],
      last_error: null,
      item_specifics: { Brand: ["Unbranded"] },
      vero_risk: "none",
    });
    expect(r.row.images).toEqual([base.images[0]]);
  });

  it("saves a too-low price as blocked_margin with the guard reasons", () => {
    const r = buildListingRow({ ...base, input: { ...input, price: 9 } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.row.status).toBe("blocked_margin");
    expect((r.row.margin_reasons as string[]).length).toBeGreaterThan(0);
    expect(r.row.last_error).toMatch(/floor/);
  });

  it("keeps a draft without cost unchecked and needs an explicit price", () => {
    expect(buildListingRow({ ...base, input: { ...input, cost: null, price: null } })).toMatchObject({ ok: false });
    const r = buildListingRow({ ...base, input: { ...input, cost: null, shipping: 5, price: 24.99 } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.guard).toBeNull();
    expect(r.row).toMatchObject({ status: "draft", manual_cost: null, manual_shipping_cost: null, net_margin_pct: null, price: 24.99 });
  });

  it("keeps the AI's high VeRO risk even if the edited text is clean", () => {
    const r = buildListingRow({ ...base, input, aiVero: { risk: "high", brandsMentioned: ["nike"], reasons: ["Swoosh logo visible."] } });
    expect(r.ok && r.row.vero_risk).toBe("high");
    expect(r.ok && r.row.vero_flags).toContain("Swoosh logo visible.");
  });

  it("rejects short titles and empty descriptions", () => {
    expect(buildListingRow({ ...base, input: { ...input, title: "Press" } })).toMatchObject({ ok: false });
    expect(buildListingRow({ ...base, input: { ...input, description: "<p> </p>" } })).toMatchObject({ ok: false });
  });
});
