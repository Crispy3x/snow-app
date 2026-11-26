"use client";

import { useActionState, useState, useTransition } from "react";
import { DataTable, td, th } from "@/components/ui/app";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import { applyTitles, optimizeTitles, type OptimizeState, type TitleSuggestion } from "./actions";

type ListingOption = { id: string; title: string; sku: string; status: string };

export function TitleOptimizer({ listings, maxBatch }: { listings: ListingOption[]; maxBatch: number }) {
  const [state, action] = useActionState<OptimizeState, FormData>(optimizeTitles, null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else if (n.size < maxBatch) n.add(id);
      return n;
    });

  return (
    <div className="grid gap-6">
      <form action={action} className="grid gap-3">
        <fieldset className="rounded-lg border border-line bg-card">
          <legend className="sr-only">Listings to optimise</legend>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3 text-sm">
            <span>
              {picked.size} of {maxBatch} selected
            </span>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setPicked(new Set(listings.slice(0, maxBatch).map((l) => l.id)))}>
                Select first {Math.min(maxBatch, listings.length)}
              </Button>
              <Button variant="ghost" onClick={() => setPicked(new Set())}>
                Clear
              </Button>
            </div>
          </div>
          <ul className="max-h-96 divide-y divide-line overflow-y-auto">
            {listings.map((l) => (
              <li key={l.id} className="flex items-start gap-3 px-4 py-2">
                <input
                  id={`pick-${l.id}`}
                  type="checkbox"
                  name="listingId"
                  value={l.id}
                  checked={picked.has(l.id)}
                  onChange={() => toggle(l.id)}
                  className="mt-1 h-4 w-4 accent-accent"
                />
                <label htmlFor={`pick-${l.id}`} className="min-w-0 flex-1 text-sm">
                  <span className="block break-words">{l.title}</span>
                  <span className="font-mono text-xs text-ink-muted">
                    {l.sku} · {l.status}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
        {!state?.suggestions && <FormMessage state={state} />}
        <div>
          <SubmitButton disabled={picked.size === 0} pendingText="Optimising…">
            Suggest new titles
          </SubmitButton>
        </div>
      </form>

      {state?.suggestions && state.requestId && <Review key={state.requestId} requestId={state.requestId} suggestions={state.suggestions} message={state.message} />}
    </div>
  );
}

function Review({ requestId, suggestions, message }: { requestId: string; suggestions: TitleSuggestion[]; message?: string }) {
  const [approved, setApproved] = useState<Set<string>>(() => new Set(suggestions.filter((s) => s.newTitle !== s.oldTitle && !s.veroWarning).map((s) => s.listingId)));
  const [titles, setTitles] = useState<Record<string, string>>(() => Object.fromEntries(suggestions.map((s) => [s.listingId, s.newTitle])));
  const [result, setResult] = useState<{ ok: boolean; message: string; applied: string[] } | null>(null);
  const [pending, start] = useTransition();
  const appliedSet = new Set(result?.applied ?? []);

  return (
    <section aria-labelledby="review-heading" className="grid gap-3">
      <h2 id="review-heading" className="text-lg font-semibold">
        Review suggestions
      </h2>
      {message && <p className="text-sm text-ink-muted">{message}</p>}
      <DataTable caption="Title suggestions, before and after">
        <thead>
          <tr>
            <th className={th} scope="col">Apply</th>
            <th className={th} scope="col">Before</th>
            <th className={th} scope="col">After</th>
            <th className={th} scope="col">Why</th>
          </tr>
        </thead>
        <tbody>
          {suggestions.map((s) => (
            <tr key={s.listingId}>
              <td className={td}>
                <input
                  type="checkbox"
                  aria-label={`Apply new title for ${s.oldTitle}`}
                  checked={approved.has(s.listingId)}
                  disabled={appliedSet.has(s.listingId)}
                  onChange={() =>
                    setApproved((p) => {
                      const n = new Set(p);
                      if (n.has(s.listingId)) n.delete(s.listingId);
                      else n.add(s.listingId);
                      return n;
                    })
                  }
                  className="h-4 w-4 accent-accent"
                />
              </td>
              <td className={`${td} max-w-[240px] break-words text-ink-muted`}>{s.oldTitle}</td>
              <td className={`${td} min-w-[240px]`}>
                <label className="sr-only" htmlFor={`t-${s.listingId}`}>
                  New title
                </label>
                <input
                  id={`t-${s.listingId}`}
                  value={titles[s.listingId]}
                  maxLength={80}
                  onChange={(e) => setTitles((t) => ({ ...t, [s.listingId]: e.target.value }))}
                  className="block w-full rounded-md border border-ink/25 bg-card px-2 py-1 text-sm"
                />
                <span className="text-xs text-ink-muted">{titles[s.listingId].length}/80</span>
                {s.veroWarning && <p className="text-xs font-medium text-danger">{s.veroWarning}</p>}
                {appliedSet.has(s.listingId) && <p className="text-xs font-medium text-accent-strong">Applied</p>}
              </td>
              <td className={`${td} max-w-[240px] text-sm text-ink-muted`}>{s.reason}</td>
            </tr>
          ))}
        </tbody>
      </DataTable>
      {result && <FormMessage state={result} />}
      <div>
        <Button
          disabled={pending || approved.size === 0}
          onClick={() =>
            start(async () => {
              const rows = [...approved].filter((id) => !appliedSet.has(id)).map((id) => ({ listingId: id, newTitle: titles[id] }));
              setResult(await applyTitles({ requestId, rows }));
            })
          }
        >
          {pending ? "Applying…" : `Apply selected (${approved.size})`}
        </Button>
      </div>
    </section>
  );
}
