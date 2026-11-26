import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/ai/run", () => ({ runAi: vi.fn() }));

const { buildSpecifics, finishDraft } = await import("../writer");
const { mockProduct } = await import("@/lib/suppliers/mock");

describe("listing writer post-processing", () => {
  it("merges AI specifics with supplier attributes and defaults Brand", () => {
    const s = buildSpecifics([{ name: "Material", values: ["Bamboo", "Bamboo"] }, { name: "color", values: ["Black"] }], { Color: "White", Size: "Large" });
    expect(s).toEqual({ Material: ["Bamboo"], color: ["Black"], Size: ["Large"], Brand: ["Unbranded"] });
  });

  it("sanitises the model output and combines VeRO with the code check", () => {
    const product = mockProduct("abc");
    const d = finishDraft(
      {
        title: "HOT SALE Nike Style Garlic Press!!! FREE SHIPPING",
        description: "<p>Great press. Visit www.example.com. 20% OFF coupon</p>",
        itemSpecifics: [],
        vero: { risk: "none", brandsMentioned: [], reasons: [] },
      },
      { product },
    );
    expect(d.title).toBe("Nike Style Garlic Press");
    expect(d.description).not.toMatch(/www|coupon|off/i);
    expect(d.vero.risk).toBe("high");
    expect(d.vero.brandsMentioned).toContain("nike");
  });
});
