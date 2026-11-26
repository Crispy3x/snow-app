import { adRateForPrice, guardPrice, priceForMargin, type CostInputs, type GuardRules } from "@/lib/margin";

/**
 * Pricing helpers shared by the monitor, offers, cleanup replacements and undo.
 * Pure functions, no I/O.
 */

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** The ad rate the margin guard assumes for a price: the top of its tier (or the flat rate). */
export function guardAdRate(rules: GuardRules, price: number): number {
  return rules.adRateTiers?.length ? adRateForPrice(rules.adRateTiers, price).max : (rules.adRatePct ?? 0);
}

/**
 * Lowest price that reaches `targetMarginPct` at the WORST case the store allows
 * (highest ad rate for the resulting price's tier plus the store's sale discount,
 * unless the caller overrides saleDiscountPct) and passes guardPrice.
 * Returns null when no price can reach it.
 */
export function safePriceForMargin(
  targetMarginPct: number,
  cost: CostInputs,
  rules: GuardRules,
  opts: { charm?: boolean } = { charm: true },
): number | null {
  const tiers = rules.adRateTiers ?? [];
  // Start from the highest rate of any tier: safe whatever tier the price lands in.
  const maxAd = tiers.length ? Math.max(...tiers.map((t) => t.max_rate)) : (rules.adRatePct ?? 0);
  const options = { charm: opts.charm, minPrice: rules.minPrice };
  let price = priceForMargin(targetMarginPct, cost, { ...rules, adRatePct: maxAd }, options);
  if (price === null) return null;
  // Try a lower price assuming the rate of the tier it would actually land in.
  const ad = guardAdRate(rules, price);
  if (ad < maxAd) {
    const lower = priceForMargin(targetMarginPct, cost, { ...rules, adRatePct: ad }, options);
    if (lower !== null && guardAdRate(rules, lower) <= ad) price = lower;
  }
  // Never return a price below the store's margin floor, whatever the target.
  return guardPrice(price, cost, rules).ok ? price : null;
}
