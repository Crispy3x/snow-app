import { describe, expect, it } from "vitest";
import { parseRulesForm, validateAdTiers } from "../rules";

const t = (min_price: string, max_price: string, min_rate = "2", max_rate = "5") => ({ min_price, max_price, min_rate, max_rate });

describe("validateAdTiers", () => {
  it("accepts adjacent tiers and sorts them", () => {
    const r = validateAdTiers([t("20", ""), t("0", "20")]);
    expect(r.errors).toEqual([]);
    expect(r.tiers).toEqual([
      { min_price: 0, max_price: 20, min_rate: 2, max_rate: 5 },
      { min_price: 20, max_price: null, min_rate: 2, max_rate: 5 },
    ]);
  });

  it("rejects overlaps and open-ended tiers that aren't last", () => {
    expect(validateAdTiers([t("0", "25"), t("20", "40")]).errors[0]).toMatch(/overlap/);
    expect(validateAdTiers([t("0", ""), t("20", "40")]).errors[0]).toMatch(/no maximum/);
  });

  it("rejects min > max for price and rate", () => {
    expect(validateAdTiers([t("30", "10")]).errors[0]).toMatch(/higher than the minimum/);
    expect(validateAdTiers([t("0", "10", "8", "4")]).errors[0]).toMatch(/at least the minimum rate/);
  });

  it("allows no tiers", () => {
    expect(validateAdTiers([])).toEqual({ tiers: [], errors: [] });
  });
});

function form(over: Record<string, string | string[]> = {}) {
  const base: Record<string, string | string[]> = {
    min_net_margin_pct: "20",
    final_value_fee_pct: "13.6",
    per_order_fee: "0.40",
    tax_on_cost_pct: "0",
    sale_discount_pct: "0",
    min_price: "5",
    handling_days: "2",
    shipping_regions: ["US", "CA"],
    monitor_action: "flag",
    monitor_interval_hours: "12",
    reprice_requires_approval: "on",
    offer_margin_pct: "",
    cleanup_after_days: "",
    ad_rate_tiers: "[]",
    ...over,
  };
  const fd = new FormData();
  for (const [k, v] of Object.entries(base)) for (const x of Array.isArray(v) ? v : [v]) fd.append(k, x);
  return fd;
}

describe("parseRulesForm", () => {
  it("parses a valid form, blanks become null", () => {
    const r = parseRulesForm(form());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.rules.final_value_fee_pct).toBe(13.6);
      expect(r.rules.shipping_regions).toEqual(["US", "CA"]);
      expect(r.rules.offer_margin_pct).toBeNull();
      expect(r.rules.cleanup_after_days).toBeNull();
      expect(r.rules.reprice_requires_approval).toBe(true);
      expect(r.rules.cleanup_queue_replacements).toBe(false);
    }
  });

  it("returns field errors", () => {
    const r = parseRulesForm(form({ min_net_margin_pct: "-1", shipping_regions: [], cleanup_after_days: "3", ad_rate_tiers: JSON.stringify([t("0", "25"), t("20", "")]) }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(Object.keys(r.fieldErrors).sort()).toEqual(["ad_rate_tiers", "cleanup_after_days", "min_net_margin_pct", "shipping_regions"]);
    }
  });
});
