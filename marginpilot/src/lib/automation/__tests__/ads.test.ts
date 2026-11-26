import { describe, expect, it } from "vitest";
import { bidForListing } from "../ads";

const tiers = [
  { min_price: 0, max_price: 20, min_rate: 2, max_rate: 4.5 },
  { min_price: 20, max_price: null, min_rate: 3, max_rate: 7 },
];

describe("bidForListing", () => {
  it("chooses min, mid or max of the tier and never exceeds the max", () => {
    expect(bidForListing(tiers, 10, "min")).toBe(2);
    expect(bidForListing(tiers, 10, "mid")).toBe(3.2); // 3.25 rounded down
    expect(bidForListing(tiers, 10, "max")).toBe(4.5);
    expect(bidForListing(tiers, 50, "mid")).toBe(5);
  });

  it("returns null without a matching tier", () => {
    expect(bidForListing([], 10, "max")).toBeNull();
  });
});
