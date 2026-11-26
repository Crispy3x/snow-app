"use client";

import { useMemo, useState, type ReactNode } from "react";
import { TextInput } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { calculate, CALCULATOR_DEFAULTS, type CalculatorField, type CalculatorInputs } from "./math";

/**
 * Free public eBay profit calculator. Runs entirely in the browser with the
 * same margin engine the app uses; nothing is sent or stored.
 */

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const pctText = (n: number) => `${n.toFixed(1)}%`;

type FieldDef = { field: CalculatorField; label: string; hint?: ReactNode };

const GROUPS: { legend: string; fields: FieldDef[] }[] = [
  {
    legend: "The sale",
    fields: [
      { field: "salePrice", label: "Sale price ($)", hint: "Your list price, including any shipping you charge the buyer." },
      { field: "saleDiscountPct", label: "Sale discount (%)", hint: "Markdown sale event, if any. 0 for none." },
    ],
  },
  {
    legend: "Your costs",
    fields: [
      { field: "itemCost", label: "Item cost ($)", hint: "What you pay the supplier per unit." },
      { field: "supplierShipping", label: "Supplier shipping ($)", hint: "Shipping to the buyer that you pay." },
      { field: "taxOnCostPct", label: "Sales tax on cost (%)", hint: "Tax the supplier charges you. 0 if you have a resale certificate." },
    ],
  },
  {
    legend: "eBay fees",
    fields: [
      {
        field: "finalValueFeePct",
        label: "Final value fee (%)",
        hint: "13.6% covers most US categories. It varies by category and store subscription, so check yours.",
      },
      { field: "perOrderFee", label: "Per-order fee ($)", hint: "$0.40 on orders over $10 ($0.30 at or under $10)." },
      { field: "adRatePct", label: "Promoted listing ad rate (%)", hint: "Charged only when the sale comes from the ad. 0 if not promoted." },
    ],
  },
];

export function ProfitCalculator() {
  const [inputs, setInputs] = useState<CalculatorInputs>(CALCULATOR_DEFAULTS);
  const result = useMemo(() => calculate(inputs), [inputs]);
  const errors = result.ok ? {} : result.errors;

  const set = (field: CalculatorField) => (e: React.ChangeEvent<HTMLInputElement>) => setInputs((prev) => ({ ...prev, [field]: e.target.value }));

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
      <form className="space-y-6" onSubmit={(e) => e.preventDefault()} noValidate aria-label="Profit calculator inputs">
        {GROUPS.map((g) => (
          <fieldset key={g.legend} className="rounded-lg border border-line bg-card p-5">
            <legend className="px-1 font-display text-lg font-semibold">{g.legend}</legend>
            <div className="mt-2 grid gap-4 sm:grid-cols-2">
              {g.fields.map((f) => (
                <TextInput
                  key={f.field}
                  id={`calc-${f.field}`}
                  name={f.field}
                  label={f.label}
                  hint={f.hint}
                  inputMode="decimal"
                  autoComplete="off"
                  value={inputs[f.field]}
                  onChange={set(f.field)}
                  error={errors[f.field]}
                  className="tabular-nums"
                />
              ))}
            </div>
          </fieldset>
        ))}
        <Button variant="secondary" onClick={() => setInputs(CALCULATOR_DEFAULTS)}>
          Reset to example values
        </Button>
      </form>

      <div className="space-y-6 lg:sticky lg:top-24 lg:self-start">
        <section aria-labelledby="calc-results-heading" className="rounded-lg border border-line bg-card">
          <h2 id="calc-results-heading" className="border-b border-line px-5 py-4 text-lg font-semibold">
            Result per order
          </h2>
          <div aria-live="polite" aria-atomic="true" className="px-5 py-4">
            {result.ok ? (
              <dl className="grid grid-cols-2 gap-4">
                <div>
                  <dt className="text-sm text-ink-muted">Net profit</dt>
                  <dd className={`font-display text-3xl font-semibold tabular-nums ${result.breakdown.net < 0 ? "text-danger" : ""}`}>
                    {usd(result.breakdown.net)}
                  </dd>
                </div>
                <div>
                  <dt className="text-sm text-ink-muted">Net margin</dt>
                  <dd className={`font-display text-3xl font-semibold tabular-nums ${result.breakdown.net < 0 ? "text-danger" : ""}`}>
                    {pctText(result.breakdown.marginPct)}
                  </dd>
                </div>
                {result.breakdown.net < 0 && (
                  <p className="col-span-2 text-sm font-medium text-danger">This price loses money on every sale.</p>
                )}
              </dl>
            ) : (
              <p className="text-sm font-medium text-danger">Fix the highlighted fields to see your profit.</p>
            )}
          </div>

          {result.ok && (
            <div className="border-t border-line px-5 py-4">
              <h3 className="text-sm font-semibold">Fee and cost breakdown</h3>
              <dl className="mt-3 space-y-2 text-sm">
                <Row label="List price" value={usd(result.breakdown.listPrice)} />
                {result.discount > 0 && <Row label="Sale discount" value={`− ${usd(result.discount)}`} />}
                <Row label="Buyer pays (sale price)" value={usd(result.breakdown.salePrice)} strong />
                <Row label="Final value fee" value={`− ${usd(result.breakdown.finalValueFee)}`} />
                <Row label="Per-order fee" value={`− ${usd(result.breakdown.perOrderFee)}`} />
                <Row label="Promoted listing fee" value={`− ${usd(result.breakdown.adFee)}`} />
                <Row label="Total eBay fees" value={`− ${usd(result.breakdown.totalFees)}`} strong />
                <Row label="Item cost, tax and shipping" value={`− ${usd(result.breakdown.landedCost)}`} />
                <Row label="Net profit" value={usd(result.breakdown.net)} strong top />
              </dl>
            </div>
          )}
        </section>

        <section aria-labelledby="calc-target-heading" className="rounded-lg border border-line bg-card p-5">
          <h2 id="calc-target-heading" className="text-lg font-semibold">
            Price needed for a target margin
          </h2>
          <div className="mt-3">
            <TextInput
              id="calc-targetMarginPct"
              name="targetMarginPct"
              label="Target net margin (%)"
              inputMode="decimal"
              autoComplete="off"
              value={inputs.targetMarginPct}
              onChange={set("targetMarginPct")}
              error={errors.targetMarginPct}
              className="tabular-nums"
            />
          </div>
          <p aria-live="polite" aria-atomic="true" className="mt-4 text-sm">
            {result.ok ? (
              result.priceForTarget === null ? (
                <span className="font-medium text-danger">
                  No price reaches {pctText(result.targetMarginPct)}: fees plus that margin add up to 100% or more.
                </span>
              ) : (
                <>
                  List at{" "}
                  <strong className="font-display text-2xl font-semibold tabular-nums">{usd(result.priceForTarget)}</strong>{" "}
                  or more for a {pctText(result.targetMarginPct)} net margin with these costs and fees.
                </>
              )
            ) : (
              <span className="text-ink-muted">Fix the highlighted fields to see the price.</span>
            )}
          </p>
        </section>
      </div>
    </div>
  );
}

function Row({ label, value, strong, top }: { label: string; value: string; strong?: boolean; top?: boolean }) {
  return (
    <div className={`flex justify-between gap-4 ${top ? "border-t border-line pt-2" : ""}`}>
      <dt className={strong ? "font-medium" : "text-ink-muted"}>{label}</dt>
      <dd className={`tabular-nums ${strong ? "font-semibold" : ""}`}>{value}</dd>
    </div>
  );
}
