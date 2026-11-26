"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { FormMessage, Select, TextInput } from "@/components/ui/form";
import { Button, buttonClasses } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";
import { Alert, DataTable, Panel, money, pct, td, th } from "@/components/ui/app";
import { Badge } from "@/components/ui/layout";
import type { MarginBreakdown } from "@/lib/margin";
import { decidePricing, runPricing, type DecisionState, type PricingResult, type PricingState } from "./actions";

export type ListingOption = { id: string; label: string; cost: number | null; shipping: number | null };

type Row = { key: number; label: string; price: string; shipping: string };

export function PricingForm({ listings, initialListingId }: { listings: ListingOption[]; initialListingId: string }) {
  const [state, action] = useActionState<PricingState, FormData>(runPricing, null);
  const [listingId, setListingId] = useState(initialListingId);
  const [rows, setRows] = useState<Row[]>([{ key: 0, label: "", price: "", shipping: "" }]);
  const [nextKey, setNextKey] = useState(1);
  const fe = state?.fieldErrors ?? {};
  const selected = listings.find((l) => l.id === listingId);

  const update = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  return (
    <>
      <Panel title="Inputs">
        <form action={action} className="grid gap-5">
          <Select
            id="listingId"
            label="Listing (optional)"
            value={listingId}
            onChange={(e) => setListingId(e.target.value)}
            options={[{ value: "", label: "None, enter costs manually" }, ...listings.map((l) => ({ value: l.id, label: l.label }))]}
            hint={selected ? (selected.cost != null ? `Supplier cost ${money(selected.cost)} + ${money(selected.shipping ?? 0)} shipping. Fill in below to override.` : "This listing has no supplier cost on file. Enter it below.") : undefined}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextInput id="cost" label="Supplier cost per unit ($)" type="number" inputMode="decimal" min={0} step="0.01" placeholder={selected?.cost != null ? String(selected.cost) : ""} error={fe.cost} />
            <TextInput id="shipping" label="Supplier shipping per unit ($)" type="number" inputMode="decimal" min={0} step="0.01" placeholder={selected?.shipping != null ? String(selected.shipping) : "0"} error={fe.shipping} />
          </div>

          <fieldset className="grid gap-3">
            <legend className="mb-1 text-sm font-medium">Competitor prices you found (optional)</legend>
            <p className="text-sm text-ink-muted">Type in prices you&apos;ve seen yourself. Nothing is looked up automatically.</p>
            {rows.map((r, i) => (
              <div key={r.key} className="grid gap-2 rounded-md border border-line p-3 sm:grid-cols-[1fr_8rem_8rem_auto] sm:items-end">
                <TextInput id={`comp_label_${r.key}`} name="comp_label" label={`Competitor ${i + 1} label`} value={r.label} maxLength={60} onChange={(e) => update(r.key, { label: e.target.value })} />
                <TextInput id={`comp_price_${r.key}`} name="comp_price" label="Price ($)" type="number" inputMode="decimal" min={0} step="0.01" value={r.price} onChange={(e) => update(r.key, { price: e.target.value })} />
                <TextInput id={`comp_shipping_${r.key}`} name="comp_shipping" label="Shipping ($)" type="number" inputMode="decimal" min={0} step="0.01" value={r.shipping} onChange={(e) => update(r.key, { shipping: e.target.value })} />
                <Button variant="ghost" onClick={() => setRows((rs) => (rs.length > 1 ? rs.filter((x) => x.key !== r.key) : [{ key: r.key, label: "", price: "", shipping: "" }]))} aria-label={`Remove competitor ${i + 1}`}>
                  Remove
                </Button>
                {fe[`comp_${i}`] && <p className="text-sm font-medium text-danger sm:col-span-4">{fe[`comp_${i}`]}</p>}
              </div>
            ))}
            <div>
              <Button
                variant="secondary"
                disabled={rows.length >= 20}
                onClick={() => {
                  setRows((rs) => [...rs, { key: nextKey, label: "", price: "", shipping: "" }]);
                  setNextKey((k) => k + 1);
                }}
              >
                Add competitor
              </Button>
            </div>
          </fieldset>

          <FormMessage state={state?.ok ? null : state} />
          <div>
            <SubmitButton pendingText="Calculating…">Get recommendation</SubmitButton>
          </div>
        </form>
      </Panel>

      {state?.result ? <ResultView key={state.result.requestId} result={state.result} /> : state?.facts ? <Candidates facts={state.facts} /> : null}
    </>
  );
}

function ResultView({ result }: { result: PricingResult }) {
  const [decision, decide] = useActionState<DecisionState, FormData>(decidePricing, null);
  const status = decision?.ok ? decision.status : undefined;
  const isDraftListing = result.listing?.status === "draft";

  return (
    <>
      <Panel title="Recommendation" description="AI draft. Review it before applying." actions={<Badge tone={status === "rejected" ? "neutral" : status ? "accent" : "amber"}>{status === "rejected" ? "Discarded" : status === "applied" ? "Applied" : status === "approved" ? "Approved" : "Draft"}</Badge>}>
        <div className="grid gap-4">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <p className="font-display text-3xl font-semibold tabular-nums">{money(result.price)}</p>
            <p className="text-ink-muted">
              {pct(result.breakdown.marginPct)} net margin · {money(result.breakdown.net)} profit per sale (worst-case ad rate)
            </p>
          </div>
          {result.clamped && (
            <Alert tone="warning">
              The AI suggested {money(result.aiPrice)}, which is below your floor price. It was raised to the floor, {money(result.facts.floor)}.
            </Alert>
          )}
          <p>{result.rationale}</p>
          {result.risks.length > 0 && (
            <div>
              <p className="text-sm font-semibold">Risks</p>
              <ul className="mt-1 list-disc pl-5 text-sm">
                {result.risks.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
          )}
          <Breakdown b={result.breakdown} />

          <FormMessage state={decision} />
          {!status && (
            <div className="flex flex-wrap gap-2">
              <form action={decide}>
                <input type="hidden" name="requestId" value={result.requestId} />
                <input type="hidden" name="decision" value="approve" />
                <SubmitButton pendingText="Saving…">Approve</SubmitButton>
              </form>
              {isDraftListing && result.listing && (
                <form action={decide}>
                  <input type="hidden" name="requestId" value={result.requestId} />
                  <input type="hidden" name="decision" value="apply_draft" />
                  <input type="hidden" name="listingId" value={result.listing.id} />
                  <input type="hidden" name="price" value={result.price} />
                  <SubmitButton variant="secondary" pendingText="Applying…">Set draft price to {money(result.price)}</SubmitButton>
                </form>
              )}
              <form action={decide}>
                <input type="hidden" name="requestId" value={result.requestId} />
                <input type="hidden" name="decision" value="reject" />
                <SubmitButton variant="ghost" pendingText="Discarding…">Discard</SubmitButton>
              </form>
            </div>
          )}
          {result.listing && !isDraftListing && status !== "rejected" && (
            <p className="text-sm">
              <Link href={`/app/listings/${result.listing.id}?price=${result.price.toFixed(2)}`} className={buttonClasses("secondary")}>
                Apply price on the listing page
              </Link>
            </p>
          )}
        </div>
      </Panel>
      <Candidates facts={result.facts} />
    </>
  );
}

function Breakdown({ b }: { b: MarginBreakdown }) {
  const rows: [string, string][] = [
    ["List price", money(b.listPrice)],
    ["Sale price (after sale discount)", money(b.salePrice)],
    ["Final value fee", `− ${money(b.finalValueFee)}`],
    ["Ad fee (worst case)", `− ${money(b.adFee)}`],
    ["Per-order fee", `− ${money(b.perOrderFee)}`],
    ["Landed cost", `− ${money(b.landedCost)}`],
    ["Net profit", money(b.net)],
    ["Net margin", pct(b.marginPct)],
  ];
  return (
    <div>
      <p className="mb-1 text-sm font-medium">Margin breakdown at this price</p>
      <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 rounded-md border border-line p-3 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className={k.startsWith("Net") ? "font-semibold" : "text-ink-muted"}>{k}</dt>
            <dd className={`text-right tabular-nums ${k.startsWith("Net") ? "font-semibold" : ""}`}>{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function Candidates({ facts }: { facts: PricingResult["facts"] }) {
  return (
    <Panel title="Price options" description={`Floor price ${money(facts.floor)}${facts.competitorMedian != null ? ` · competitor median ${money(facts.competitorMedian)} delivered (${facts.competitorCount} entered)` : ""}`}>
      <DataTable caption="Margin at candidate prices">
        <thead>
          <tr>
            <th className={th}>Price</th>
            <th className={th}>Basis</th>
            <th className={th}>Fees</th>
            <th className={th}>Net</th>
            <th className={th}>Margin</th>
            <th className={th}>Rules</th>
          </tr>
        </thead>
        <tbody>
          {facts.candidates.map((c) => (
            <tr key={c.price}>
              <td className={`${td} tabular-nums font-medium`}>{money(c.price)}</td>
              <td className={td}>{c.label}</td>
              <td className={`${td} tabular-nums`}>{money(c.breakdown.totalFees)}</td>
              <td className={`${td} tabular-nums`}>{money(c.breakdown.net)}</td>
              <td className={`${td} tabular-nums`}>{pct(c.breakdown.marginPct)}</td>
              <td className={td}>{c.ok ? <Badge tone="accent">Passes</Badge> : <Badge tone="danger">Below floor</Badge>}</td>
            </tr>
          ))}
        </tbody>
      </DataTable>
    </Panel>
  );
}
