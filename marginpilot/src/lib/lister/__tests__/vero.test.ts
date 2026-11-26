import { describe, expect, it } from "vitest";
import { checkVero, combineVero, findBrands } from "../vero";

describe("VeRO check", () => {
  it("passes generic product text", () => {
    const r = checkVero("Stainless Garlic Press - Black, dishwasher safe kitchen tool");
    expect(r.risk).toBe("none");
    expect(r.brandsMentioned).toEqual([]);
  });

  it("flags protected brand names as high risk", () => {
    const r = checkVero("Nike style running shoes with Louis Vuitton print");
    expect(r.risk).toBe("high");
    expect(r.brandsMentioned).toEqual(expect.arrayContaining(["nike", "louis vuitton"]));
  });

  it("matches whole words only", () => {
    expect(findBrands("Snikers bar holder")).not.toContain("nike");
    expect(findBrands("Legoland map poster")).not.toContain("lego");
    expect(findBrands("Lego compatible bricks")).toContain("lego");
  });

  it("treats ambiguous words as brands only when capitalised, and as low risk", () => {
    expect(findBrands("apple slicer and corer")).toEqual([]);
    const r = checkVero("Charger for Apple devices");
    expect(r.brandsMentioned).toContain("apple");
    expect(r.risk).toBe("low");
  });

  it("collapses aliases", () => {
    expect(findBrands("The North Face style jacket")).toEqual(["the north face"]);
  });

  it("flags replica wording", () => {
    const r = checkVero("Designer inspired by handbag, AAA quality");
    expect(r.risk).toBe("high");
    expect(r.reasons.join(" ")).toMatch(/replica|counterfeit/i);
  });

  it("flags compatible-with brand phrasing", () => {
    const r = checkVero("Case compatible with Samsung Galaxy S24");
    expect(r.risk).toBe("high"); // samsung is a strong brand
    expect(r.reasons.some((x) => x.includes("Compatible with"))).toBe(true);
  });

  it("flags trademark symbols as low risk", () => {
    expect(checkVero("SuperGrip™ handle").risk).toBe("low");
  });

  it("combines AI and code results: highest risk wins, lists merge", () => {
    const c = combineVero(
      { risk: "low", brandsMentioned: ["Acme"], reasons: ["a"] },
      { risk: "high", brandsMentioned: ["nike", "acme"], reasons: ["b", "a"] },
    );
    expect(c.risk).toBe("high");
    expect(c.brandsMentioned).toEqual(["acme", "nike"]);
    expect(c.reasons).toEqual(["a", "b"]);
  });
});
