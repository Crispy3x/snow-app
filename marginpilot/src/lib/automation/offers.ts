import { guardPrice, type CostInputs, type GuardRules } from "@/lib/margin";
import { safePriceForMargin } from "./pricing";

/**
 * Offers to watchers (eBay Negotiation API). Pure, no I/O.
 * The offer replaces the list price for that buyer, so no sale discount applies,
 * but the worst-case ad rate still does, and the price must pass the margin floor.
 */

export type OfferQuote =
  | { ok: true; price: number; marginPct: number; discountPct: number }
  | { ok: false; reason: string; price: number | null };

export function computeOfferPrice(input: {
  targetMarginPct: number;
  currentPrice: number;
  cost: CostInputs;
  rules: GuardRules;
}): OfferQuote {
  const rules: GuardRules = { ...input.rules, saleDiscountPct: 0 };
  if (!(input.targetMarginPct > 0)) return { ok: false, reason: "Choose a target margin above 0%.", price: null };
  if (input.targetMarginPct < rules.minNetMarginPct) {
    return { ok: false, reason: `Target margin is below the store's ${rules.minNetMarginPct}% floor.`, price: null };
  }
  const price = safePriceForMargin(input.targetMarginPct, input.cost, rules, { charm: false });
  if (price === null) return { ok: false, reason: `No price reaches a ${input.targetMarginPct}% margin at this cost.`, price: null };
  if (price >= input.currentPrice) {
    return { ok: false, reason: "The offer would not be below the current price.", price };
  }
  const guard = guardPrice(price, input.cost, rules);
  if (!guard.ok) return { ok: false, reason: guard.reasons.join(" "), price };
  const discountPct = Math.round((1 - price / input.currentPrice) * 1000) / 10;
  return { ok: true, price, marginPct: guard.breakdown.marginPct, discountPct };
}
