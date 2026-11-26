import { describe, expect, it } from "vitest";
import { safeNext } from "../redirect";

describe("safeNext", () => {
  it("keeps same-site paths", () => {
    expect(safeNext("/app/billing?reason=no_plan")).toBe("/app/billing?reason=no_plan");
    expect(safeNext("/auth/invite?token=abc")).toBe("/auth/invite?token=abc");
  });
  it("rejects open redirects and junk", () => {
    for (const bad of ["//evil.com", "/\\evil.com", "https://evil.com", "evil.com", "/\tevil", "", null, undefined, 42]) {
      expect(safeNext(bad)).toBe("/app");
    }
  });
  it("uses the given fallback", () => {
    expect(safeNext("//x", "/app/billing")).toBe("/app/billing");
  });
});
