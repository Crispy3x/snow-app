/**
 * Margin engine. Pure functions, no I/O, fully unit tested.
 *
 * Net profit on one order:
 *   salePrice   = listPrice × (1 − saleDiscount%)
 *   eBay fees   = salePrice × (finalValueFee% + adRate%) + perOrderFee
 *   landed cost = supplierCost × (1 + taxOnCost%) + supplierShipping
 *   net         = salePrice − eBay fees − landed cost
 *   net margin  = net ÷ salePrice
 *
 * Defaults match eBay's most common US rates (13.6% final value fee, $0.40 per order).
 * Fee rates vary by category and store subscription, so every rate is editable per store.
 */

export type FeeRules = {
  finalValueFeePct: number; // default 13.6
  perOrderFee: number; // default 0.40
  adRatePct?: number; // promoted listing rate, % of sale price
  saleDiscountPct?: number; // markdown sale event
  taxOnCostPct?: number; // sales tax paid to the supplier
};

export type CostInputs = {
  supplierCost: number;
  supplierShipping?: number;
};

export type AdRateTier = { min_price: number; max_price: number | null; min_rate: number; max_rate: number };

export const DEFAULT_FEES: FeeRules = { finalValueFeePct: 13.6, perOrderFee: 0.4, adRatePct: 0, saleDiscountPct: 0, taxOnCostPct: 0 };

export type MarginBreakdown = {
  listPrice: number;
  salePrice: number;
  finalValueFee: number;
  adFee: number;
  perOrderFee: number;
  landedCost: number;
  totalFees: number;
  net: number;
  marginPct: number; // net ÷ salePrice × 100
};

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function landedCost(cost: CostInputs, rules: Pick<FeeRules, "taxOnCostPct">): number {
  return cost.supplierCost * (1 + (rules.taxOnCostPct ?? 0) / 100) + (cost.supplierShipping ?? 0);
}

export function computeMargin(listPrice: number, cost: CostInputs, rules: FeeRules): MarginBreakdown {
  if (!(listPrice > 0)) throw new RangeError("listPrice must be greater than 0");
  if (cost.supplierCost < 0) throw new RangeError("supplierCost cannot be negative");
  const salePrice = listPrice * (1 - (rules.saleDiscountPct ?? 0) / 100);
  const finalValueFee = (salePrice * rules.finalValueFeePct) / 100;
  const adFee = (salePrice * (rules.adRatePct ?? 0)) / 100;
  const lc = landedCost(cost, rules);
  const totalFees = finalValueFee + adFee + rules.perOrderFee;
  const net = salePrice - totalFees - lc;
  return {
    listPrice: round2(listPrice),
    salePrice: round2(salePrice),
    finalValueFee: round2(finalValueFee),
    adFee: round2(adFee),
    perOrderFee: round2(rules.perOrderFee),
    landedCost: round2(lc),
    totalFees: round2(totalFees),
    net: round2(net),
    marginPct: round2((net / salePrice) * 100),
  };
}

/**
 * Lowest list price that reaches `targetMarginPct` after fees, ad rate and sale discount.
 * With `charm`, rounds up to the next .99 (never down, so the margin still holds).
 * Returns null when no price can reach the target (fees + margin ≥ 100%).
 */
export function priceForMargin(
  targetMarginPct: number,
  cost: CostInputs,
  rules: FeeRules,
  opts: { charm?: boolean; minPrice?: number } = {},
): number | null {
  const variableShare = (rules.finalValueFeePct + (rules.adRatePct ?? 0) + targetMarginPct) / 100;
  if (variableShare >= 1) return null;
  const salePrice = (landedCost(cost, rules) + rules.perOrderFee) / (1 - variableShare);
  let listPrice = salePrice / (1 - (rules.saleDiscountPct ?? 0) / 100);
  listPrice = Math.ceil(listPrice * 100 - 1e-6) / 100; // round up to the cent
  if (opts.charm) {
    const whole = Math.floor(listPrice);
    listPrice = listPrice <= whole + 0.99 ? whole + 0.99 : whole + 1.99;
  }
  if (opts.minPrice && listPrice < opts.minPrice) listPrice = opts.minPrice;
  return round2(listPrice);
}

/** The ad-rate range for a price from the store's tiers; {0,0} when no tier matches. */
export function adRateForPrice(tiers: AdRateTier[], price: number): { min: number; max: number } {
  const t = tiers.find((t) => price >= t.min_price && (t.max_price === null || price < t.max_price));
  return t ? { min: t.min_rate, max: t.max_rate } : { min: 0, max: 0 };
}

export type GuardRules = FeeRules & { minNetMarginPct: number; minPrice?: number; adRateTiers?: AdRateTier[] };

export type GuardResult = {
  ok: boolean;
  breakdown: MarginBreakdown;
  reasons: string[];
  /** Price that would pass, when the given one doesn't. */
  suggestedPrice: number | null;
};

/**
 * The margin guard. Checks a price at the worst case the store allows:
 * the highest ad rate for its price tier and the store's sale discount.
 * Nothing should publish, reprice or be offered when ok is false.
 */
export function guardPrice(listPrice: number, cost: CostInputs, rules: GuardRules): GuardResult {
  const ad = rules.adRateTiers?.length ? adRateForPrice(rules.adRateTiers, listPrice).max : (rules.adRatePct ?? 0);
  const worst: FeeRules = { ...rules, adRatePct: ad };
  const breakdown = computeMargin(listPrice, cost, worst);
  const reasons: string[] = [];
  if (breakdown.marginPct < rules.minNetMarginPct) {
    reasons.push(`Net margin ${breakdown.marginPct}% is below the ${rules.minNetMarginPct}% floor.`);
  }
  if (rules.minPrice && listPrice < rules.minPrice) {
    reasons.push(`Price $${listPrice.toFixed(2)} is below the store minimum of $${rules.minPrice.toFixed(2)}.`);
  }
  const ok = reasons.length === 0;
  return {
    ok,
    breakdown,
    reasons,
    suggestedPrice: ok ? null : priceForMargin(rules.minNetMarginPct, cost, worst, { charm: true, minPrice: rules.minPrice }),
  };
}

/** Map a store_rules row (snake_case, numerics as strings from Postgres) to GuardRules. */
export function rulesFromRow(row: {
  final_value_fee_pct: number | string;
  per_order_fee: number | string;
  tax_on_cost_pct: number | string;
  sale_discount_pct: number | string;
  min_net_margin_pct: number | string;
  min_price: number | string;
  ad_rate_tiers: AdRateTier[] | null;
}): GuardRules {
  return {
    finalValueFeePct: Number(row.final_value_fee_pct),
    perOrderFee: Number(row.per_order_fee),
    taxOnCostPct: Number(row.tax_on_cost_pct),
    saleDiscountPct: Number(row.sale_discount_pct),
    minNetMarginPct: Number(row.min_net_margin_pct),
    minPrice: Number(row.min_price) || undefined,
    adRateTiers: row.ad_rate_tiers ?? [],
  };
}
