import {
  guardPrice,
  priceForMargin,
  rulesFromRow,
  type AdRateTier,
  type CostInputs,
  type GuardResult,
  type GuardRules,
} from "@/lib/margin";

/**
 * Pricing for new listings. Pure, unit tested.
 * The price is the lowest .99 price that reaches the target margin at the
 * WORST-CASE ad rate the store allows for that price (highest rate of its tier),
 * never below the store minimum, and it is always re-checked with guardPrice.
 */

export const DEFAULT_RULES: GuardRules = {
  finalValueFeePct: 13.6,
  perOrderFee: 0.4,
  taxOnCostPct: 0,
  saleDiscountPct: 0,
  minNetMarginPct: 20,
  minPrice: undefined,
  adRateTiers: [],
};

export const STORE_RULES_COLUMNS =
  "final_value_fee_pct, per_order_fee, tax_on_cost_pct, sale_discount_pct, min_net_margin_pct, min_price, ad_rate_tiers";

export function rulesOrDefault(row: Parameters<typeof rulesFromRow>[0] | null | undefined): GuardRules {
  return row ? rulesFromRow(row) : DEFAULT_RULES;
}

function maxTierRate(tiers: AdRateTier[] | undefined): number {
  return (tiers ?? []).reduce((m, t) => Math.max(m, Number(t.max_rate) || 0), 0);
}

function tierMax(tiers: AdRateTier[], price: number): number {
  const t = tiers.find((t) => price >= t.min_price && (t.max_price === null || price < t.max_price));
  return t ? t.max_rate : 0;
}

export type PriceResult =
  | { ok: true; price: number; adRatePct: number; guard: GuardResult; targetMarginPct: number }
  | { ok: false; price: number | null; adRatePct: number; guard: GuardResult | null; targetMarginPct: number; reasons: string[] };

/**
 * Price for a target margin. The target can't be below the store floor.
 * 1. Price at the highest ad rate of any tier (always safe).
 * 2. Try the tier rate that applies to that price; keep the lower price only if it
 *    falls in a tier whose worst-case rate still passes the guard.
 */
export function priceListing(targetMarginPct: number, cost: CostInputs, rules: GuardRules): PriceResult {
  const target = Math.max(targetMarginPct, rules.minNetMarginPct);
  const tiers = rules.adRateTiers ?? [];
  const safeRate = tiers.length ? maxTierRate(tiers) : (rules.adRatePct ?? 0);
  const opts = { charm: true, minPrice: rules.minPrice };

  let price = priceForMargin(target, cost, { ...rules, adRatePct: safeRate }, opts);
  if (price === null) {
    return {
      ok: false,
      price: null,
      adRatePct: safeRate,
      guard: null,
      targetMarginPct: target,
      reasons: [`No price can reach a ${target}% margin with these fees and ad rates.`],
    };
  }

  if (tiers.length) {
    const tierRate = tierMax(tiers, price);
    if (tierRate < safeRate) {
      const lower = priceForMargin(target, cost, { ...rules, adRatePct: tierRate }, opts);
      if (lower !== null && lower < price) {
        const g = guardPrice(lower, cost, rules);
        const ach = g.breakdown.marginPct;
        if (g.ok && ach >= target) price = lower;
      }
    }
  }

  const guard = guardPrice(price, cost, rules);
  const adRatePct = tiers.length ? tierMax(tiers, price) : (rules.adRatePct ?? 0);
  if (!guard.ok) return { ok: false, price, adRatePct, guard, targetMarginPct: target, reasons: guard.reasons };
  return { ok: true, price, adRatePct, guard, targetMarginPct: target };
}

/** Deterministic SKU for a bulk item (retries find the same listing), random otherwise. */
export function makeSku(seed?: string): string {
  if (seed) return `MP-${seed.replace(/[^a-z0-9]/gi, "").slice(0, 10).toUpperCase()}`;
  const rand = Array.from({ length: 10 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 32)]).join("");
  return `MP-${rand}`;
}
