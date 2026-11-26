import { z } from "zod";
import type { AdRateTier } from "@/lib/margin";

/**
 * Store rules validation, shared by the rules form (client) and its server action.
 * No server-only imports here.
 */

export const SHIPPING_REGIONS = [
  { value: "US", label: "United States" },
  { value: "CA", label: "Canada" },
  { value: "GB", label: "United Kingdom" },
  { value: "AU", label: "Australia" },
  { value: "EU", label: "European Union" },
  { value: "WORLDWIDE", label: "Worldwide" },
] as const;

export const MONITOR_ACTIONS = [
  { value: "flag", label: "Flag it for me to review" },
  { value: "reprice", label: "Propose a new price that keeps my margin" },
  { value: "out_of_stock", label: "Set quantity to 0 (out of stock)" },
] as const;

export type TierInput = { min_price: string; max_price: string; min_rate: string; max_rate: string };

/** Validates ad-rate tiers. Returns the parsed tiers (sorted by min price) or a list of problems. */
export function validateAdTiers(rows: TierInput[]): { tiers: AdRateTier[]; errors: string[] } {
  const errors: string[] = [];
  const tiers: AdRateTier[] = [];
  rows.forEach((r, i) => {
    const n = i + 1;
    const min = Number(r.min_price);
    const max = r.max_price.trim() === "" ? null : Number(r.max_price);
    const minRate = Number(r.min_rate);
    const maxRate = Number(r.max_rate);
    if (r.min_price.trim() === "" || !Number.isFinite(min) || min < 0) errors.push(`Tier ${n}: enter a minimum price of 0 or more.`);
    if (max !== null && (!Number.isFinite(max) || max <= min)) errors.push(`Tier ${n}: the maximum price must be higher than the minimum.`);
    if (r.min_rate.trim() === "" || !Number.isFinite(minRate) || minRate < 2 || minRate > 100)
      errors.push(`Tier ${n}: the minimum ad rate must be between 2% (eBay's minimum) and 100%.`);
    if (r.max_rate.trim() === "" || !Number.isFinite(maxRate) || maxRate < minRate || maxRate > 100)
      errors.push(`Tier ${n}: the maximum ad rate must be at least the minimum rate and at most 100%.`);
    tiers.push({ min_price: min, max_price: max, min_rate: minRate, max_rate: maxRate });
  });
  if (errors.length) return { tiers: [], errors };

  tiers.sort((a, b) => a.min_price - b.min_price);
  for (let i = 0; i < tiers.length - 1; i++) {
    const a = tiers[i];
    const b = tiers[i + 1];
    if (a.max_price === null) {
      errors.push(`The tier starting at $${a.min_price} has no maximum, so it overlaps the tier starting at $${b.min_price}.`);
    } else if (a.max_price > b.min_price) {
      errors.push(`Tiers $${a.min_price}–$${a.max_price} and $${b.min_price}+ overlap.`);
    }
  }
  return { tiers: errors.length ? [] : tiers, errors };
}

const pctField = (max: number) => z.coerce.number({ error: "Enter a number." }).min(0, "Can't be negative.").max(max, `At most ${max}%.`);
const optional = <T extends z.ZodType>(s: T) => z.preprocess((v) => (v === "" || v === null || v === undefined ? null : v), s.nullable());

export const rulesSchema = z.object({
  min_net_margin_pct: pctField(90),
  final_value_fee_pct: pctField(30),
  per_order_fee: z.coerce.number({ error: "Enter a number." }).min(0, "Can't be negative.").max(5, "At most $5."),
  tax_on_cost_pct: pctField(25),
  sale_discount_pct: pctField(80),
  min_price: z.coerce.number({ error: "Enter a number." }).min(0, "Can't be negative.").max(100000),
  handling_days: z.coerce.number().int("Whole days only.").min(0, "Can't be negative.").max(30, "At most 30 days."),
  shipping_regions: z.array(z.enum(SHIPPING_REGIONS.map((r) => r.value) as [string, ...string[]])).min(1, "Choose at least one region."),
  monitor_action: z.enum(["reprice", "out_of_stock", "flag"]),
  monitor_interval_hours: z.coerce.number().int("Whole hours only.").min(1, "At least 1 hour.").max(168, "At most 168 hours (a week)."),
  reprice_requires_approval: z.boolean(),
  offer_margin_pct: optional(pctField(90)),
  cleanup_after_days: optional(z.coerce.number().int("Whole days only.").min(7, "At least 7 days.").max(365, "At most 365 days.")),
  cleanup_queue_replacements: z.boolean(),
});

export type RulesInput = z.infer<typeof rulesSchema>;

export function parseRulesForm(fd: FormData):
  | { ok: true; rules: RulesInput & { ad_rate_tiers: AdRateTier[] } }
  | { ok: false; fieldErrors: Record<string, string> } {
  const raw = {
    min_net_margin_pct: fd.get("min_net_margin_pct"),
    final_value_fee_pct: fd.get("final_value_fee_pct"),
    per_order_fee: fd.get("per_order_fee"),
    tax_on_cost_pct: fd.get("tax_on_cost_pct"),
    sale_discount_pct: fd.get("sale_discount_pct"),
    min_price: fd.get("min_price"),
    handling_days: fd.get("handling_days"),
    shipping_regions: fd.getAll("shipping_regions").map(String),
    monitor_action: fd.get("monitor_action"),
    monitor_interval_hours: fd.get("monitor_interval_hours"),
    reprice_requires_approval: fd.get("reprice_requires_approval") === "on",
    offer_margin_pct: fd.get("offer_margin_pct"),
    cleanup_after_days: fd.get("cleanup_after_days"),
    cleanup_queue_replacements: fd.get("cleanup_queue_replacements") === "on",
  };
  const fieldErrors: Record<string, string> = {};
  const parsed = rulesSchema.safeParse(raw);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const k = String(issue.path[0] ?? "form");
      fieldErrors[k] ??= issue.message;
    }
  }

  let tierRows: TierInput[] = [];
  try {
    const v = JSON.parse(String(fd.get("ad_rate_tiers") ?? "[]"));
    if (Array.isArray(v)) tierRows = v.map((r) => ({ min_price: String(r.min_price ?? ""), max_price: String(r.max_price ?? ""), min_rate: String(r.min_rate ?? ""), max_rate: String(r.max_rate ?? "") }));
  } catch {
    fieldErrors.ad_rate_tiers = "Ad-rate tiers couldn't be read. Reload the page and try again.";
  }
  const { tiers, errors } = validateAdTiers(tierRows);
  if (errors.length) fieldErrors.ad_rate_tiers = errors.join(" ");

  if (!parsed.success || Object.keys(fieldErrors).length) return { ok: false, fieldErrors };
  return { ok: true, rules: { ...parsed.data, ad_rate_tiers: tiers } };
}
