import { describe, expect, it } from "vitest";
import { FLAG_KEY_PATTERN, evaluateFlag, parseAllowlist } from "../flag-rules";
import { escapeLike, groupUsage, monthRange, totalUsage, type UsageRow } from "../usage";

const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "22222222-2222-4222-8222-222222222222";

describe("evaluateFlag", () => {
  it("is off for unknown flags", () => {
    expect(evaluateFlag(undefined, ORG_A)).toBe(false);
  });
  it("is on for everyone when enabled", () => {
    expect(evaluateFlag({ key: "x", enabled: true, org_allowlist: [] }, ORG_A)).toBe(true);
    expect(evaluateFlag({ key: "x", enabled: true, org_allowlist: [] }, null)).toBe(true);
  });
  it("is on only for allowlisted orgs when disabled", () => {
    const f = { key: "x", enabled: false, org_allowlist: [ORG_A] };
    expect(evaluateFlag(f, ORG_A)).toBe(true);
    expect(evaluateFlag(f, ORG_B)).toBe(false);
    expect(evaluateFlag(f, undefined)).toBe(false);
  });
});

describe("flag keys and allowlists", () => {
  it("accepts sensible keys only", () => {
    expect(FLAG_KEY_PATTERN.test("bulk_lister.v2")).toBe(true);
    expect(FLAG_KEY_PATTERN.test("Bulk")).toBe(false);
    expect(FLAG_KEY_PATTERN.test("1abc")).toBe(false);
    expect(FLAG_KEY_PATTERN.test("a b")).toBe(false);
  });
  it("parses UUIDs separated by commas or lines, reporting bad entries", () => {
    expect(parseAllowlist(`${ORG_A},\n${ORG_B.toUpperCase()} ${ORG_A} nope`)).toEqual({
      ids: [ORG_A, ORG_B],
      invalid: ["nope"],
    });
  });
});

describe("monthRange", () => {
  const now = new Date("2026-11-26T12:00:00Z");
  it("defaults to the current UTC month", () => {
    expect(monthRange(undefined, now)).toEqual({
      month: "2026-11",
      from: "2026-11-01T00:00:00.000Z",
      to: "2026-12-01T00:00:00.000Z",
      periodStart: "2026-11-01",
    });
  });
  it("handles December rollover and ignores bad input", () => {
    expect(monthRange("2026-12", now).to).toBe("2027-01-01T00:00:00.000Z");
    expect(monthRange("2026-13", now).month).toBe("2026-11");
    expect(monthRange("drop table", now).month).toBe("2026-11");
  });
});

describe("usage aggregation", () => {
  const rows: UsageRow[] = [
    { org_id: ORG_A, user_id: "u1", tool: "research", model: "claude-opus-5-5", status: "ok", requests: 3, input_tokens: 1000, output_tokens: 500, cache_read_tokens: 0, cost_usd: "0.014", credits: 30 },
    { org_id: ORG_A, user_id: "u1", tool: "research", model: "claude-opus-5-5", status: "refused", requests: 1, input_tokens: 100, output_tokens: 0, cache_read_tokens: 0, cost_usd: "0.0004", credits: 0 },
    { org_id: ORG_B, user_id: "u2", tool: "title_optimizer", model: "claude-haiku-5-5", status: "ok", requests: 10, input_tokens: 5000, output_tokens: 1000, cache_read_tokens: 200, cost_usd: "0.001", credits: 10 },
    { org_id: ORG_B, user_id: null, tool: "title_optimizer", model: "claude-haiku-5-5", status: "rate_limited", requests: 2, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cost_usd: 0, credits: 0 },
  ];

  it("totals requests, tokens, cost, credits, errors and refusals", () => {
    const t = totalUsage(rows);
    expect(t.requests).toBe(16);
    expect(t.inputTokens).toBe(6100);
    expect(t.credits).toBe(40);
    expect(t.errors).toBe(2);
    expect(t.refusals).toBe(1);
    expect(t.costUsd).toBeCloseTo(0.0154, 6);
  });

  it("groups by org sorted by cost", () => {
    const g = groupUsage(rows, (r) => r.org_id);
    expect(g.map((x) => x.key)).toEqual([ORG_A, ORG_B]);
    expect(g[1].totals.requests).toBe(12);
  });

  it("groups by tool and model", () => {
    const g = groupUsage(rows, (r) => `${r.tool}|${r.model}`);
    expect(g).toHaveLength(2);
  });
});

describe("escapeLike", () => {
  it("escapes wildcards", () => {
    expect(escapeLike("50%_off\\")).toBe("50\\%\\_off\\\\");
  });
});
