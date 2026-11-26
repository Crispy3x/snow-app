import { z } from "zod";
import { adRateForPrice, guardPrice, priceForMargin, type CostInputs, type GuardRules, type MarginBreakdown } from "@/lib/margin";

/**
 * Pricing advisor math. Pure and deterministic: the AI only explains and picks
 * within these numbers, and its pick is clamped to the floor in code.
 *
 * eBay terms (PLAN.md §4B): no eBay data is used to model prices. Competitor
 * prices are only the ones the seller types in.
 */

export type CompetitorPrice = { label: string; price: number; shipping: number };

export type PriceCandidate = {
  price: number;
  label: string;
  ok: boolean;
  breakdown: MarginBreakdown;
  reasons: string[];
};

export type PricingFacts = {
  /** Lowest list price that keeps the store's margin floor at the worst-case ad rate; null when unreachable. */
  floor: number | null;
  worstAdRatePct: number;
  competitorCount: number;
  /** Median delivered price (price + shipping) of the competitors the seller entered. */
  competitorMedian: number | null;
  competitorMin: number | null;
  competitorMax: number | null;
  candidates: PriceCandidate[];
};

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function median(values: number[]): number | null {
  const v = values.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return round2(v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2);
}

/** Highest ad rate any price could carry under the store's tiers (or the flat rate). */
export function worstCaseAdRate(rules: GuardRules): number {
  if (rules.adRateTiers?.length) return Math.max(...rules.adRateTiers.map((t) => t.max_rate));
  return rules.adRatePct ?? 0;
}

/**
 * Floor price: the lowest list price that passes guardPrice() (margin floor at the
 * max ad rate for that price's tier, store sale discount, store minimum price).
 * Tries each tier's own max rate, keeps prices that land inside that tier, and falls
 * back to the overall worst-case rate, which always passes.
 */
export function floorPrice(cost: CostInputs, rules: GuardRules): number | null {
  const target = rules.minNetMarginPct;
  const opts = { minPrice: rules.minPrice };
  const conservative = priceForMargin(target, cost, { ...rules, adRatePct: worstCaseAdRate(rules) }, opts);
  if (conservative === null) return null;

  const tiers = rules.adRateTiers ?? [];
  const candidates: number[] = [conservative];
  if (tiers.length) {
    for (const t of tiers) {
      const p = priceForMargin(target, cost, { ...rules, adRatePct: t.max_rate }, opts);
      if (p !== null && adRateForPrice(tiers, p).max === t.max_rate) candidates.push(p);
    }
    const p0 = priceForMargin(target, cost, { ...rules, adRatePct: 0 }, opts);
    if (p0 !== null && adRateForPrice(tiers, p0).max === 0) candidates.push(p0);
  }
  const passing = candidates.filter((p) => guardPrice(p, cost, rules).ok).sort((a, b) => a - b);
  return passing[0] ?? conservative;
}

export function computePricingFacts(input: {
  cost: CostInputs;
  rules: GuardRules;
  competitors: CompetitorPrice[];
  currentPrice?: number | null;
}): PricingFacts {
  const { cost, rules } = input;
  const floor = floorPrice(cost, rules);
  const delivered = input.competitors.map((c) => round2(c.price + (c.shipping || 0))).filter((n) => n > 0);
  const competitorMedian = median(delivered);
  const competitorMin = delivered.length ? Math.min(...delivered) : null;
  const competitorMax = delivered.length ? Math.max(...delivered) : null;

  const raw: { price: number | null | undefined; label: string }[] = [
    { price: floor, label: "Floor (lowest price that keeps your margin rule)" },
    { price: floor !== null ? round2(floor * 1.1) : null, label: "Floor + 10%" },
    { price: floor !== null ? round2(floor * 1.2) : null, label: "Floor + 20%" },
    { price: competitorMin, label: "Lowest competitor (delivered)" },
    { price: competitorMedian, label: "Competitor median (delivered)" },
    { price: competitorMax, label: "Highest competitor (delivered)" },
    { price: input.currentPrice, label: "Current price" },
  ];
  const seen = new Map<number, PriceCandidate>();
  for (const r of raw) {
    if (r.price == null || !(r.price > 0)) continue;
    const p = round2(r.price);
    if (seen.has(p)) {
      seen.get(p)!.label += ` / ${r.label}`;
      continue;
    }
    const g = guardPrice(p, cost, rules);
    seen.set(p, { price: p, label: r.label, ok: g.ok, breakdown: g.breakdown, reasons: g.reasons });
  }

  return {
    floor,
    worstAdRatePct: worstCaseAdRate(rules),
    competitorCount: delivered.length,
    competitorMedian,
    competitorMin,
    competitorMax,
    candidates: [...seen.values()].sort((a, b) => a.price - b.price),
  };
}

/** Never let the AI recommend below the floor. Returns null when no price can meet the rules. */
export function clampRecommendation(aiPrice: number, floor: number | null): { price: number; clamped: boolean } | null {
  if (floor === null) return null;
  const p = Number.isFinite(aiPrice) && aiPrice > 0 ? round2(aiPrice) : floor;
  return p < floor ? { price: floor, clamped: true } : { price: p, clamped: !(Number.isFinite(aiPrice) && aiPrice > 0) };
}

export const PricingAdviceSchema = z.object({
  recommendedPrice: z.number().describe("Recommended list price in USD"),
  rationale: z.string().describe("Two to four sentences explaining the choice using only the numbers given"),
  risks: z.array(z.string()).describe("Short risk notes, e.g. thin margin, priced above competitors"),
});
export type PricingAdvice = z.infer<typeof PricingAdviceSchema>;

/** The only content sent to the model: numbers and the seller's own competitor labels. */
export function buildPricingPrompt(facts: PricingFacts, rules: GuardRules, cost: CostInputs, competitors: CompetitorPrice[]): string {
  const lines = [
    `Landed cost inputs: supplier cost $${cost.supplierCost.toFixed(2)}, supplier shipping $${(cost.supplierShipping ?? 0).toFixed(2)}.`,
    `Store rules: margin floor ${rules.minNetMarginPct}%, final value fee ${rules.finalValueFeePct}%, per-order fee $${rules.perOrderFee.toFixed(2)}, sale discount ${rules.saleDiscountPct ?? 0}%, tax on cost ${rules.taxOnCostPct ?? 0}%, worst-case ad rate ${facts.worstAdRatePct}%${rules.minPrice ? `, minimum price $${rules.minPrice.toFixed(2)}` : ""}.`,
    `Floor price: ${facts.floor === null ? "none (the rules cannot be met at any price)" : `$${facts.floor.toFixed(2)}`}.`,
    competitors.length
      ? `Competitor prices the seller entered (delivered = price + shipping):\n${competitors
          .map((c) => `- ${c.label.slice(0, 60) || "Competitor"}: $${c.price.toFixed(2)} + $${(c.shipping || 0).toFixed(2)} shipping`)
          .join("\n")}\nMedian delivered: $${facts.competitorMedian?.toFixed(2)}.`
      : "No competitor prices were entered.",
    "Margin at candidate prices (worst-case ad rate):",
    ...facts.candidates.map(
      (c) => `- $${c.price.toFixed(2)} (${c.label}): net $${c.breakdown.net.toFixed(2)}, margin ${c.breakdown.marginPct}%${c.ok ? "" : " — FAILS store rules"}`,
    ),
  ];
  return lines.join("\n");
}

export const PRICING_SYSTEM = `You are the pricing advisor in an eBay seller tool. Recommend one list price for a fixed-price listing.
Use ONLY the numbers provided. Never recommend a price below the floor price. Do not invent market data, sold prices or demand figures.
Prefer a price at or below the competitor median when it still clears the floor; if the floor is above competitors, say the item may not be competitive.
Keep the rationale short and practical.`;
