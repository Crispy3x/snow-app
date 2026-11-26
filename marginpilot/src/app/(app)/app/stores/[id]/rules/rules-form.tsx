"use client";

import { useActionState, useMemo, useState } from "react";
import { guardPrice, type AdRateTier } from "@/lib/margin";
import { MONITOR_ACTIONS, SHIPPING_REGIONS, validateAdTiers, type TierInput } from "@/lib/ebay/rules";
import { Checkbox, FormMessage, Select, TextInput, type ActionState } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";
import { saveRules } from "./actions";

export type RulesValues = {
  min_net_margin_pct: number;
  final_value_fee_pct: number;
  per_order_fee: number;
  tax_on_cost_pct: number;
  sale_discount_pct: number;
  min_price: number;
  handling_days: number;
  shipping_regions: string[];
  ad_rate_tiers: AdRateTier[];
  monitor_action: string;
  monitor_interval_hours: number;
  reprice_requires_approval: boolean;
  offer_margin_pct: number | null;
  cleanup_after_days: number | null;
  cleanup_queue_replacements: boolean;
};

type Snapshot = Record<string, string>;

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const num = (v: string | undefined, fallback = 0) => {
  const n = Number(v);
  return v === undefined || v === "" || !Number.isFinite(n) ? fallback : n;
};

function toSnapshot(v: RulesValues): Snapshot {
  return {
    min_net_margin_pct: String(v.min_net_margin_pct),
    final_value_fee_pct: String(v.final_value_fee_pct),
    per_order_fee: String(v.per_order_fee),
    tax_on_cost_pct: String(v.tax_on_cost_pct),
    sale_discount_pct: String(v.sale_discount_pct),
    min_price: String(v.min_price),
  };
}

export function RulesForm({ storeId, values, canEdit }: { storeId: string; values: RulesValues; canEdit: boolean }) {
  const [state, action] = useActionState<ActionState, FormData>(saveRules.bind(null, storeId), null);
  const [snap, setSnap] = useState<Snapshot>(() => toSnapshot(values));
  const [tiers, setTiers] = useState<TierInput[]>(() =>
    values.ad_rate_tiers.map((t) => ({
      min_price: String(t.min_price),
      max_price: t.max_price === null ? "" : String(t.max_price),
      min_rate: String(t.min_rate),
      max_rate: String(t.max_rate),
    })),
  );
  const tierCheck = useMemo(() => validateAdTiers(tiers), [tiers]);
  const fe = state?.ok ? {} : (state?.fieldErrors ?? {});

  function onInput(e: React.FormEvent<HTMLFormElement>) {
    const fd = new FormData(e.currentTarget);
    setSnap(Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === "string")) as Snapshot);
  }

  const updateTier = (i: number, k: keyof TierInput, v: string) => setTiers((ts) => ts.map((t, j) => (j === i ? { ...t, [k]: v } : t)));

  return (
    <form action={action} onInput={onInput} className="space-y-8">
      <input type="hidden" name="ad_rate_tiers" value={JSON.stringify(tiers)} />
      <fieldset disabled={!canEdit} className="space-y-8">
        <section aria-labelledby="fees-h" className="space-y-4">
          <div>
            <h3 id="fees-h" className="text-base font-semibold">Margin and fees</h3>
            <p className="text-sm text-ink-muted">
              Every price the app sets is checked against these numbers at the worst case: the highest ad rate for the price tier and your sale
              discount. Nothing publishes, reprices or goes out as an offer below your minimum margin.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <TextInput id="min_net_margin_pct" label="Minimum net margin (%)" type="number" step="0.1" min={0} max={90} required
              defaultValue={values.min_net_margin_pct} error={fe.min_net_margin_pct} hint="Profit after all fees and costs, as a share of the sale price." />
            <TextInput id="final_value_fee_pct" label="Final value fee (%)" type="number" step="0.01" min={0} max={30} required
              defaultValue={values.final_value_fee_pct} error={fe.final_value_fee_pct}
              hint="13.6% is eBay's rate for most US categories without a Store subscription. Some categories and Store plans pay less or more, so use your own rate." />
            <TextInput id="per_order_fee" label="Per-order fee ($)" type="number" step="0.01" min={0} max={5} required
              defaultValue={values.per_order_fee} error={fe.per_order_fee} hint="In the US eBay charges $0.40 per order over $10 and $0.30 on orders of $10 or less. $0.40 is the safe default." />
            <TextInput id="tax_on_cost_pct" label="Sales tax on supplier cost (%)" type="number" step="0.01" min={0} max={25} required
              defaultValue={values.tax_on_cost_pct} error={fe.tax_on_cost_pct} hint="Leave at 0 if you buy with a resale certificate." />
            <TextInput id="sale_discount_pct" label="Sale event discount (%)" type="number" step="0.1" min={0} max={80} required
              defaultValue={values.sale_discount_pct} error={fe.sale_discount_pct} hint="Markdown you run on listings. Prices are set so the margin still holds during the sale." />
            <TextInput id="min_price" label="Minimum price ($)" type="number" step="0.01" min={0} required
              defaultValue={values.min_price} error={fe.min_price} hint="Never list or reprice below this." />
          </div>
        </section>

        <section aria-labelledby="ads-h" className="space-y-3">
          <div>
            <h3 id="ads-h" className="text-base font-semibold">Promoted listings ad rates</h3>
            <p className="text-sm text-ink-muted">
              Ad rate ranges by price. The margin check always assumes the maximum rate. Leave the last tier&apos;s maximum price blank for
              &ldquo;and above&rdquo;. No tiers means no ads.
            </p>
          </div>
          {tiers.length > 0 && (
            <ul className="space-y-3">
              {tiers.map((t, i) => (
                <li key={i} className="rounded-md border border-line p-3">
                  <p className="mb-2 text-sm font-medium">Tier {i + 1}</p>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-5 sm:items-end">
                    <TextInput id={`tier-${i}-min`} name="" label="From price ($)" type="number" step="0.01" min={0} value={t.min_price}
                      onChange={(e) => updateTier(i, "min_price", e.target.value)} />
                    <TextInput id={`tier-${i}-max`} name="" label="Up to price ($)" type="number" step="0.01" min={0} value={t.max_price}
                      placeholder="and above" onChange={(e) => updateTier(i, "max_price", e.target.value)} />
                    <TextInput id={`tier-${i}-minr`} name="" label="Min rate (%)" type="number" step="0.1" min={2} max={100} value={t.min_rate}
                      onChange={(e) => updateTier(i, "min_rate", e.target.value)} />
                    <TextInput id={`tier-${i}-maxr`} name="" label="Max rate (%)" type="number" step="0.1" min={2} max={100} value={t.max_rate}
                      onChange={(e) => updateTier(i, "max_rate", e.target.value)} />
                    <Button variant="ghost" className="col-span-2 sm:col-span-1" onClick={() => setTiers((ts) => ts.filter((_, j) => j !== i))}>
                      Remove tier {i + 1}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {(fe.ad_rate_tiers || (tiers.length > 0 && tierCheck.errors.length > 0)) && (
            <div id="ad_rate_tiers-error" role="alert" className="text-sm font-medium text-danger">
              {(tierCheck.errors.length ? tierCheck.errors : [fe.ad_rate_tiers]).map((m) => (
                <p key={m}>{m}</p>
              ))}
            </div>
          )}
          <Button
            variant="secondary"
            onClick={() =>
              setTiers((ts) => {
                const lastMax = ts.length ? ts[ts.length - 1].max_price : "0";
                return [...ts, { min_price: lastMax || "", max_price: "", min_rate: "2", max_rate: "5" }];
              })
            }
          >
            Add a tier
          </Button>
        </section>

        <section aria-labelledby="ship-h" className="space-y-4">
          <h3 id="ship-h" className="text-base font-semibold">Shipping</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextInput id="handling_days" label="Handling time (business days)" type="number" min={0} max={30} required
              defaultValue={values.handling_days} error={fe.handling_days} hint="Days between the sale and shipping. Include your supplier's processing time." />
          </div>
          <fieldset aria-describedby={fe.shipping_regions ? "regions-error" : undefined}>
            <legend className="mb-2 text-sm font-medium">Ship to</legend>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {SHIPPING_REGIONS.map((r) => (
                <Checkbox key={r.value} id={`region-${r.value}`} name="shipping_regions" value={r.value} label={r.label}
                  defaultChecked={values.shipping_regions.includes(r.value)} />
              ))}
            </div>
            {fe.shipping_regions && <p id="regions-error" className="mt-1 text-sm font-medium text-danger">{fe.shipping_regions}</p>}
          </fieldset>
        </section>

        <section aria-labelledby="mon-h" className="space-y-4">
          <div>
            <h3 id="mon-h" className="text-base font-semibold">Supplier price and stock monitor</h3>
            <p className="text-sm text-ink-muted">What happens when a supplier&apos;s cost or stock changes.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Select id="monitor_action" label="When a supplier changes" defaultValue={values.monitor_action} options={[...MONITOR_ACTIONS]} error={fe.monitor_action} />
            <TextInput id="monitor_interval_hours" label="Check every (hours)" type="number" min={1} max={168} required
              defaultValue={values.monitor_interval_hours} error={fe.monitor_interval_hours} />
          </div>
          <Checkbox id="reprice_requires_approval" label="Price changes need my approval" defaultChecked={values.reprice_requires_approval}
            hint="Recommended. eBay's API License Agreement prohibits automatically repricing eBay listings in response to price changes on other sites. With this on, a cost change creates a proposal that you approve before anything changes on eBay." />
        </section>

        <section aria-labelledby="off-h" className="space-y-4">
          <h3 id="off-h" className="text-base font-semibold">Offers and cleanup</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextInput id="offer_margin_pct" label="Margin to keep on offers to watchers (%)" type="number" step="0.1" min={0} max={90}
              defaultValue={values.offer_margin_pct ?? ""} error={fe.offer_margin_pct} hint="Blank uses your minimum net margin." />
            <TextInput id="cleanup_after_days" label="Suggest ending listings with no sales after (days)" type="number" min={7} max={365}
              defaultValue={values.cleanup_after_days ?? ""} error={fe.cleanup_after_days} hint="Blank turns cleanup off. Suggestions are never applied without you." />
          </div>
          <Checkbox id="cleanup_queue_replacements" label="Queue replacement products for listings I end" defaultChecked={values.cleanup_queue_replacements} />
        </section>
      </fieldset>

      <MarginPreview snap={snap} tiers={tierCheck.errors.length ? [] : tierCheck.tiers} />

      <div className="space-y-3">
        <FormMessage state={state} />
        {canEdit && <SubmitButton pendingText="Saving rules…">Save rules</SubmitButton>}
      </div>
    </form>
  );
}

function MarginPreview({ snap, tiers }: { snap: Snapshot; tiers: AdRateTier[] }) {
  const [price, setPrice] = useState("29.99");
  const [cost, setCost] = useState("12.00");
  const [shipping, setShipping] = useState("0");

  const p = num(price);
  const c = num(cost);
  const result =
    p > 0 && c >= 0
      ? guardPrice(p, { supplierCost: c, supplierShipping: num(shipping) }, {
          finalValueFeePct: num(snap.final_value_fee_pct, 13.6),
          perOrderFee: num(snap.per_order_fee, 0.4),
          taxOnCostPct: num(snap.tax_on_cost_pct),
          saleDiscountPct: num(snap.sale_discount_pct),
          minNetMarginPct: num(snap.min_net_margin_pct),
          minPrice: num(snap.min_price) || undefined,
          adRateTiers: tiers,
        })
      : null;

  const b = result?.breakdown;
  return (
    <section aria-labelledby="preview-h" className="rounded-lg border border-line bg-paper p-4">
      <h3 id="preview-h" className="text-base font-semibold">Margin preview</h3>
      <p className="text-sm text-ink-muted">Try a price and cost. Updates as you edit the rules above. Not saved.</p>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <TextInput id="preview-price" name="" label="List price ($)" type="number" step="0.01" min={0} value={price} onChange={(e) => setPrice(e.target.value)} />
        <TextInput id="preview-cost" name="" label="Supplier cost ($)" type="number" step="0.01" min={0} value={cost} onChange={(e) => setCost(e.target.value)} />
        <TextInput id="preview-ship" name="" label="Supplier shipping ($)" type="number" step="0.01" min={0} value={shipping} onChange={(e) => setShipping(e.target.value)} />
      </div>
      <div aria-live="polite" className="mt-4">
        {!result || !b ? (
          <p className="text-sm text-ink-muted">Enter a price above 0 to see the breakdown.</p>
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
              <dt className="text-ink-muted">Sale price</dt><dd className="text-right tabular-nums sm:text-left">{money(b.salePrice)}</dd>
              <dt className="text-ink-muted">Final value fee</dt><dd className="text-right tabular-nums sm:text-left">{money(b.finalValueFee)}</dd>
              <dt className="text-ink-muted">Ad fee (max rate)</dt><dd className="text-right tabular-nums sm:text-left">{money(b.adFee)}</dd>
              <dt className="text-ink-muted">Per-order fee</dt><dd className="text-right tabular-nums sm:text-left">{money(b.perOrderFee)}</dd>
              <dt className="text-ink-muted">Landed cost</dt><dd className="text-right tabular-nums sm:text-left">{money(b.landedCost)}</dd>
              <dt className="font-medium">Net profit</dt><dd className="text-right font-semibold tabular-nums sm:text-left">{money(b.net)}</dd>
              <dt className="font-medium">Net margin</dt><dd className="text-right font-semibold tabular-nums sm:text-left">{b.marginPct.toFixed(1)}%</dd>
            </dl>
            <p className={`mt-3 rounded-md border px-3 py-2 text-sm ${result.ok ? "border-accent/30 bg-accent-soft text-accent-strong" : "border-danger/30 bg-red-50 text-danger"}`}>
              {result.ok
                ? "Passes the margin guard."
                : `${result.reasons.join(" ")}${result.suggestedPrice ? ` Lowest passing price: ${money(result.suggestedPrice)}.` : " No price can reach this margin with these fees."}`}
            </p>
          </>
        )}
      </div>
    </section>
  );
}
