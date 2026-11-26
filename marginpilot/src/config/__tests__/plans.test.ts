import { describe, expect, it } from "vitest";
import { PLANS, formatUsd, isSaleActive, salePrice } from "../plans";

const sale = { name: "T", percentOff: 50, startsAt: "2026-11-24T00:00:00Z", endsAt: "2027-01-01T07:59:59Z", discountIsForever: true };

describe("plans", () => {
  it("shows $47 / $247 / $497 at 50% off", () => {
    expect(PLANS.map((p) => salePrice(p.monthly))).toEqual([47, 247, 497]);
  });
  it("sale is only active inside its window", () => {
    expect(isSaleActive(new Date("2026-11-23T23:59:59Z"), sale)).toBe(false);
    expect(isSaleActive(new Date("2026-11-27T12:00:00Z"), sale)).toBe(true);
    expect(isSaleActive(new Date("2026-12-31T23:00:00Z"), sale)).toBe(true);
    expect(isSaleActive(new Date("2027-01-01T08:00:00Z"), sale)).toBe(false);
  });
  it("formats whole and fractional dollars", () => {
    expect(formatUsd(47)).toBe("$47");
    expect(formatUsd(23.5)).toBe("$23.50");
  });
});
