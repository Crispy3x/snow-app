"use client";

import { useActionState, useMemo, useState } from "react";
import { guardPrice, type GuardRules } from "@/lib/margin";
import { Alert, TextLink, money } from "@/components/ui/app";
import { Button } from "@/components/ui/button";
import { FormMessage, Select, TextArea, TextInput } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import { discardDraft, generateDraft, saveDraftListing, type WriterDraft, type WriterState } from "./actions";

type SupplierOption = { id: string; name: string };

export function ListingWriter({ suppliers, rules }: { suppliers: SupplierOption[]; rules: GuardRules }) {
  const [genState, genAction] = useActionState<WriterState, FormData>(generateDraft, null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const draft = genState?.draft && genState.draft.requestId !== dismissed ? genState.draft : null;

  return (
    <div className="grid gap-6">
      <form action={genAction} className="grid gap-4 rounded-lg border border-line bg-card p-5">
        <TextArea
          id="input"
          label="Supplier link or product text"
          rows={6}
          required
          placeholder={"https://mock-supplier.test/p/abc123\n\nor paste the supplier's title, description and specs"}
          hint="Links must be from a wholesale supplier you've added. Retail store links are rejected."
        />
        {suppliers.length > 0 && (
          <Select
            id="supplierId"
            label="Supplier (for links)"
            options={[{ value: "", label: "Detect from the link" }, ...suppliers.map((s) => ({ value: s.id, label: s.name }))]}
          />
        )}
        {(!genState?.ok || !draft) && <FormMessage state={genState} />}
        <div>
          <SubmitButton pendingText="Writing draft…">Write draft</SubmitButton>
        </div>
      </form>

      {draft && <DraftEditor key={draft.requestId} draft={draft} rules={rules} onDiscard={() => setDismissed(draft.requestId)} />}
    </div>
  );
}

function DraftEditor({ draft, rules, onDiscard }: { draft: WriterDraft; rules: GuardRules; onDiscard: () => void }) {
  const [state, action] = useActionState<WriterState, FormData>(saveDraftListing, null);
  const [title, setTitle] = useState(draft.title);
  const [price, setPrice] = useState(draft.suggestedPrice ? draft.suggestedPrice.toFixed(2) : "");
  const [cost, setCost] = useState(draft.cost !== null ? String(draft.cost) : "");
  const [shipping, setShipping] = useState(draft.shipping !== null ? String(draft.shipping) : "0");
  const [specifics, setSpecifics] = useState(() =>
    Object.entries(draft.itemSpecifics)
      .map(([k, v]) => `${k}: ${v.join(", ")}`)
      .join("\n"),
  );
  const specificsJson = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const line of specifics.split("\n")) {
      const i = line.indexOf(":");
      if (i <= 0) continue;
      const k = line.slice(0, i).trim();
      const vals = line.slice(i + 1).split(",").map((s) => s.trim()).filter(Boolean);
      if (k && vals.length) out[k] = vals;
    }
    return JSON.stringify(out);
  }, [specifics]);
  const guard = useMemo(() => {
    const p = Number(price), c = Number(cost);
    return p > 0 && cost !== "" && c >= 0 ? guardPrice(p, { supplierCost: c, supplierShipping: Number(shipping) || 0 }, rules) : null;
  }, [price, cost, shipping, rules]);

  if (state?.saved) {
    return (
      <Alert tone="success" title="Saved">
        {state.message} <TextLink href={`/app/listings/${state.saved.listingId}`}>Open the listing</TextLink>
      </Alert>
    );
  }

  return (
    <section aria-labelledby="draft-heading" className="grid gap-4 rounded-lg border border-line bg-card p-5">
      <div className="flex flex-col gap-1">
        <h2 id="draft-heading" className="text-lg font-semibold">
          Draft
        </h2>
        <p className="text-sm text-ink-muted">AI-written. Nothing is saved or listed until you approve it.</p>
      </div>

      {draft.vero.risk !== "none" && (
        <Alert tone={draft.vero.risk === "high" ? "danger" : "warning"} title={draft.vero.risk === "high" ? "Brand (VeRO) risk: high" : "Brand (VeRO) risk: low"}>
          {draft.vero.brandsMentioned.length > 0 && <p>Brands or trademarks found: {draft.vero.brandsMentioned.join(", ")}</p>}
          <ul className="mt-1 list-disc pl-5">
            {draft.vero.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </Alert>
      )}

      <form action={action} className="grid gap-4">
        <input type="hidden" name="requestId" value={draft.requestId} />
        <input type="hidden" name="specifics" value={specificsJson} />
        {draft.source && (
          <>
            <input type="hidden" name="supplierId" value={draft.source.supplierId} />
            <input type="hidden" name="sourceRef" value={draft.source.ref} />
          </>
        )}
        <TextInput id="title" label="Title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} required hint={`${title.length} of 80 characters`} />
        <TextArea id="description" label="Description" defaultValue={draft.description} rows={10} required hint="Simple HTML. Links and contact details are removed on save." />
        <TextArea id="specifics-text" name="specifics-text" label="Item specifics" value={specifics} onChange={(e) => setSpecifics(e.target.value)} rows={6} hint='One per line, like "Material: Bamboo". Separate several values with commas.' />
        <TextArea id="images" label="Photo URLs" defaultValue={draft.images.join("\n")} rows={3} hint="One https:// URL per line. Clean promo banners with the Image cleaner after saving." />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <TextInput id="cost" label="Item cost (USD)" type="number" step="0.01" min="0" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} required />
          <TextInput id="shipping" label="Supplier shipping (USD)" type="number" step="0.01" min="0" inputMode="decimal" value={shipping} onChange={(e) => setShipping(e.target.value)} />
          <TextInput id="price" label="Price (USD)" type="number" step="0.01" min="0.01" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} required />
          <TextInput id="quantity" label="Quantity" type="number" step="1" min="0" defaultValue={Math.min(draft.stock ?? 1, 10)} required />
        </div>
        <p aria-live="polite" className={`text-sm ${guard && !guard.ok ? "text-danger" : "text-ink-muted"}`}>
          {!guard
            ? `Enter cost and price to check the margin (floor ${rules.minNetMarginPct}%).`
            : guard.ok
              ? `Net margin ${guard.breakdown.marginPct.toFixed(1)}% at the worst-case ad rate (profit ${money(guard.breakdown.net)}).`
              : `${guard.reasons.join(" ")}${guard.suggestedPrice ? ` Lowest passing price: ${money(guard.suggestedPrice)}.` : ""} It can be saved but will be blocked from publishing.`}
        </p>
        <FormMessage state={state} />
        <div className="flex flex-wrap gap-2">
          <SubmitButton pendingText="Saving…">Save as draft listing</SubmitButton>
          <Button
            variant="ghost"
            onClick={async () => {
              const fd = new FormData();
              fd.set("requestId", draft.requestId);
              await discardDraft(fd);
              onDiscard();
            }}
          >
            Discard
          </Button>
        </div>
      </form>
    </section>
  );
}
