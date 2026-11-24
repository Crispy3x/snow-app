import { describe, expect, it } from "vitest";
import { formatPrice } from "../brand";

describe("formatPrice", () => {
  it("shows a placeholder until a price is set", () => {
    expect(formatPrice(null)).toBe("[PRICE]");
  });
  it("formats a set price", () => {
    expect(formatPrice(49)).toBe("$49");
  });
});
