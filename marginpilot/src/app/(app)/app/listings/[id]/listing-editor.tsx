"use client";

import { useActionState, useMemo, useState } from "react";
import { guardPrice, type GuardRules } from "@/lib/margin";
import { FormMessage, TextArea, TextInput, type ActionState } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import { money } from "@/components/ui/app";
import { endListingAction, publishDraft, saveListing } from "./actions";

export type EditorListing = {
  id: string;
  title: string;
  description: string;
  price: number;
  quantity: number;
  status: string;
  linkedCost: { cost: number; shipping: number } | null;
  manualCost: number | null;
  manualShipping: number | null;
};

const LIVE = new Set(["active", "out_of_stock"]);

export function ListingEditor({ listing, rules }: { listing: EditorListing; rules: GuardRules }) {
  const [state, action] = useActionState<ActionState, FormData>(saveListing, null);
  const [title, setTitle] = useState(listing.title);
  const [price, setPrice] = useState(String(listing.price));
  const [cost, setCost] = useState(listing.manualCost !== null ? String(listing.manualCost) : "");
  const [shipping, setShipping] = useState(listing.manualShipping !== null ? String(listing.manualShipping) : "");
  const fe = state?.fieldErrors ?? {};
  const live = LIVE.has(listing.status);

  const costInputs = listing.linkedCost
    ? { supplierCost: listing.linkedCost.cost, supplierShipping: listing.linkedCost.shipping }
    : cost !== "" && Number(cost) >= 0
      ? { supplierCost: Number(cost), supplierShipping: Number(shipping) || 0 }
      : null;
  const p = Number(price);
  const guard = useMemo(() => (costInputs && p > 0 ? guardPrice(p, costInputs, rules) : null), [costInputs?.supplierCost, costInputs?.supplierShipping, p, rules]); // eslint-disable-line react-hooks/exhaustive-deps
  const blockedSave = live && (!guard || !guard.ok);

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <form action={action} className="grid gap-4" aria-describedby="margin-check">
        <input type="hidden" name="id" value={listing.id} />
        <TextInput
          id="title"
          label="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={80}
          required
          error={fe.title}
          hint={`${title.length} of 80 characters`}
        />
        <TextArea id="description" label="Description" defaultValue={listing.description} rows={10} error={fe.description} hint="Simple HTML is kept (paragraphs, lists, bold). Links and contact details are removed." />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextInput id="price" label="Price (USD)" type="number" step="0.01" min="0.01" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} required error={fe.price} />
          <TextInput id="quantity" label="Quantity" type="number" step="1" min="0" inputMode="numeric" defaultValue={listing.quantity} required error={fe.quantity} />
        </div>
        {!listing.linkedCost && (
          <div className="grid gap-4 sm:grid-cols-2">
            <TextInput id="cost" label="Item cost (USD)" type="number" step="0.01" min="0" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} error={fe.cost} hint="Your wholesale cost per unit." />
            <TextInput id="shipping" label="Supplier shipping (USD)" type="number" step="0.01" min="0" inputMode="decimal" value={shipping} onChange={(e) => setShipping(e.target.value)} error={fe.shipping} />
          </div>
        )}
        <FormMessage state={state} />
        <div>
          <SubmitButton disabled={blockedSave} pendingText={live ? "Updating eBay…" : "Saving…"}>
            {live ? "Save and update eBay" : "Save draft"}
          </SubmitButton>
          {blockedSave && <p className="mt-2 text-sm text-danger">Live listings can&apos;t be saved below the margin floor.</p>}
        </div>
      </form>

      <MarginPanel guard={guard} rules={rules} onUseSuggested={(v) => setPrice(v.toFixed(2))} />
    </div>
  );
}

function MarginPanel({ guard, rules, onUseSuggested }: { guard: ReturnType<typeof guardPrice> | null; rules: GuardRules; onUseSuggested: (v: number) => void }) {
  return (
    <section id="margin-check" aria-live="polite" className="h-fit rounded-lg border border-line bg-card p-4">
      <h2 className="text-base font-semibold">Margin check</h2>
      <p className="text-sm text-ink-muted">At the worst-case ad rate and sale discount your rules allow. Floor: {rules.minNetMarginPct}%.</p>
      {!guard ? (
        <p className="mt-3 text-sm">Enter a price and cost to see the margin.</p>
      ) : (
        <>
          <p className={`mt-3 font-display text-2xl font-semibold tabular-nums ${guard.ok ? "text-accent-strong" : "text-danger"}`}>
            {guard.breakdown.marginPct.toFixed(1)}% net
          </p>
          <dl className="mt-3 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
            <dt className="text-ink-muted">Sale price</dt>
            <dd className="text-right tabular-nums">{money(guard.breakdown.salePrice)}</dd>
            <dt className="text-ink-muted">Final value fee</dt>
            <dd className="text-right tabular-nums">−{money(guard.breakdown.finalValueFee)}</dd>
            <dt className="text-ink-muted">Ad fee (worst case)</dt>
            <dd className="text-right tabular-nums">−{money(guard.breakdown.adFee)}</dd>
            <dt className="text-ink-muted">Per-order fee</dt>
            <dd className="text-right tabular-nums">−{money(guard.breakdown.perOrderFee)}</dd>
            <dt className="text-ink-muted">Landed cost</dt>
            <dd className="text-right tabular-nums">−{money(guard.breakdown.landedCost)}</dd>
            <dt className="border-t border-line pt-1 font-medium">Net profit</dt>
            <dd className="border-t border-line pt-1 text-right font-medium tabular-nums">{money(guard.breakdown.net)}</dd>
          </dl>
          {!guard.ok && (
            <div className="mt-3 grid gap-2 text-sm">
              {guard.reasons.map((r) => (
                <p key={r} className="text-danger">
                  {r}
                </p>
              ))}
              {guard.suggestedPrice && (
                <button type="button" className="text-left font-medium text-accent underline underline-offset-2" onClick={() => onUseSuggested(guard.suggestedPrice!)}>
                  Use {money(guard.suggestedPrice)} (lowest passing price)
                </button>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

export function PublishButton({ id }: { id: string }) {
  const [state, action] = useActionState<ActionState, FormData>(publishDraft, null);
  return (
    <form action={action} className="grid gap-2">
      <input type="hidden" name="id" value={id} />
      <div>
        <SubmitButton pendingText="Publishing…">Publish to eBay</SubmitButton>
      </div>
      <FormMessage state={state} />
    </form>
  );
}

export function EndButton({ id }: { id: string }) {
  const [state, action] = useActionState<ActionState, FormData>(endListingAction, null);
  return (
    <form
      action={action}
      className="grid gap-2"
      onSubmit={(e) => {
        if (!confirm("End this listing on eBay? You can undo it from the activity log.")) e.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={id} />
      <div>
        <SubmitButton variant="secondary" pendingText="Ending…">
          End listing
        </SubmitButton>
      </div>
      <FormMessage state={state} />
    </form>
  );
}
