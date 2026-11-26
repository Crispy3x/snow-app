import { computeMargin, DEFAULT_FEES, priceForMargin, type FeeRules, type MarginBreakdown } from "@/lib/margin";

/**
 * Glue between the public calculator's text inputs and the margin engine.
 * Pure, so it is unit tested and runs entirely in the browser (nothing is stored).
 */

export type CalculatorInputs = {
  salePrice: string;
  itemCost: string;
  supplierShipping: string;
  taxOnCostPct: string;
  finalValueFeePct: string;
  perOrderFee: string;
  adRatePct: string;
  saleDiscountPct: string;
  targetMarginPct: string;
};

export type CalculatorField = keyof CalculatorInputs;

export const CALCULATOR_DEFAULTS: CalculatorInputs = {
  salePrice: "29.99",
  itemCost: "9.50",
  supplierShipping: "3.00",
  taxOnCostPct: String(DEFAULT_FEES.taxOnCostPct ?? 0),
  finalValueFeePct: String(DEFAULT_FEES.finalValueFeePct),
  perOrderFee: DEFAULT_FEES.perOrderFee.toFixed(2),
  adRatePct: String(DEFAULT_FEES.adRatePct ?? 0),
  saleDiscountPct: String(DEFAULT_FEES.saleDiscountPct ?? 0),
  targetMarginPct: "25",
};

export type CalculatorResult =
  | { ok: false; errors: Partial<Record<CalculatorField, string>> }
  | {
      ok: true;
      breakdown: MarginBreakdown;
      discount: number; // list price minus sale price
      targetMarginPct: number;
      priceForTarget: number | null; // null when fees + target margin reach 100%
    };

type Rule = { label: string; min: number; max?: number; required?: boolean; positive?: boolean };

const RULES: Record<CalculatorField, Rule> = {
  salePrice: { label: "Sale price", min: 0, max: 1_000_000, required: true, positive: true },
  itemCost: { label: "Item cost", min: 0, max: 1_000_000, required: true },
  supplierShipping: { label: "Supplier shipping", min: 0, max: 100_000 },
  taxOnCostPct: { label: "Tax on cost", min: 0, max: 100 },
  finalValueFeePct: { label: "Final value fee", min: 0, max: 99 },
  perOrderFee: { label: "Per-order fee", min: 0, max: 1000 },
  adRatePct: { label: "Promoted listing ad rate", min: 0, max: 99 },
  saleDiscountPct: { label: "Sale discount", min: 0, max: 99 },
  targetMarginPct: { label: "Target margin", min: 0, max: 99 },
};

/** Accepts "1,299.50", " $12 " or "13.6%"; empty -> null. */
export function parseNumber(raw: string): number | null {
  const s = raw.replace(/[$,%\s]/g, "");
  if (s === "") return null;
  if (!/^-?\d*\.?\d+$/.test(s) && !/^-?\d+\.$/.test(s)) return NaN;
  return Number(s);
}

export function calculate(inputs: CalculatorInputs): CalculatorResult {
  const errors: Partial<Record<CalculatorField, string>> = {};
  const values = {} as Record<CalculatorField, number>;
  for (const field of Object.keys(RULES) as CalculatorField[]) {
    const rule = RULES[field];
    const n = parseNumber(inputs[field]);
    if (n === null) {
      if (rule.required) errors[field] = `Enter the ${rule.label.toLowerCase()}.`;
      values[field] = 0;
      continue;
    }
    if (Number.isNaN(n)) errors[field] = "Enter a number, like 12.50.";
    else if (rule.positive && n <= 0) errors[field] = `${rule.label} must be more than 0.`;
    else if (n < rule.min) errors[field] = `${rule.label} can't be negative.`;
    else if (rule.max !== undefined && n > rule.max) errors[field] = `${rule.label} must be ${rule.max.toLocaleString("en-US")} or less.`;
    values[field] = n;
  }
  if (Object.keys(errors).length) return { ok: false, errors };

  const rules: FeeRules = {
    finalValueFeePct: values.finalValueFeePct,
    perOrderFee: values.perOrderFee,
    adRatePct: values.adRatePct,
    saleDiscountPct: values.saleDiscountPct,
    taxOnCostPct: values.taxOnCostPct,
  };
  const cost = { supplierCost: values.itemCost, supplierShipping: values.supplierShipping };
  const breakdown = computeMargin(values.salePrice, cost, rules);
  return {
    ok: true,
    breakdown,
    discount: Math.round((breakdown.listPrice - breakdown.salePrice) * 100) / 100,
    targetMarginPct: values.targetMarginPct,
    priceForTarget: priceForMargin(values.targetMarginPct, cost, rules),
  };
}
