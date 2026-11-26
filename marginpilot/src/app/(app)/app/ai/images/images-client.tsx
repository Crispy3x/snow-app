"use client";

import { useActionState, useState } from "react";
import { Alert, TextLink } from "@/components/ui/app";
import { Button } from "@/components/ui/button";
import { FormMessage, Select, TextInput } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import { analyzeImage, approveImage, discardImage, type CleanState } from "./actions";

type ListingOption = { id: string; title: string; images: string[] };

export function ImageCleaner({ listings, initialListing }: { listings: ListingOption[]; initialListing: string }) {
  const [state, action] = useActionState<CleanState, FormData>(analyzeImage, null);
  const [listingId, setListingId] = useState(initialListing);
  const [imageIndex, setImageIndex] = useState(0);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const listing = listings.find((l) => l.id === listingId);
  const result = state?.ok && state.requestId !== dismissed ? state : null;

  return (
    <div className="grid gap-6">
      <form action={action} className="grid gap-4 rounded-lg border border-line bg-card p-5">
        <Select
          id="listingId"
          label="Listing"
          value={listingId}
          onChange={(e) => {
            setListingId(e.target.value);
            setImageIndex(0);
          }}
          options={[{ value: "", label: listings.length ? "Choose a listing…" : "No listings with photos" }, ...listings.map((l) => ({ value: l.id, label: l.title }))]}
        />
        {listing && listing.images.length > 0 && (
          <fieldset>
            <legend className="mb-1 text-sm font-medium">Photo</legend>
            <div className="flex flex-wrap gap-2">
              {listing.images.map((src, i) => (
                <label key={src + i} className={`cursor-pointer rounded border-2 p-0.5 ${imageIndex === i ? "border-accent" : "border-transparent"}`}>
                  <input type="radio" name="imageIndex" value={i} checked={imageIndex === i} onChange={() => setImageIndex(i)} className="sr-only" />
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt={`Photo ${i + 1}`} className="h-16 w-16 rounded object-cover" />
                </label>
              ))}
            </div>
          </fieldset>
        )}
        <TextInput id="imageUrl" label="Or paste an image URL" type="url" placeholder="https://…" hint="A pasted URL is used instead of the listing photo." />
        {!result && <FormMessage state={state} />}
        <div>
          <SubmitButton pendingText="Checking photo…">Find and remove promo overlays</SubmitButton>
        </div>
      </form>

      {result && <Result key={result.requestId} state={result} onDone={() => setDismissed(result.requestId ?? null)} />}
    </div>
  );
}

function Result({ state, onDone }: { state: NonNullable<CleanState>; onDone: () => void }) {
  const [approved, approve] = useActionState<CleanState, FormData>(approveImage, null);
  const final = approved?.ok ? approved : null;

  return (
    <section aria-labelledby="result-heading" className="grid gap-4 rounded-lg border border-line bg-card p-5">
      <h2 id="result-heading" className="text-lg font-semibold">
        Result
      </h2>
      <p className="text-sm">{state.message}</p>
      {state.aiReason && <p className="text-sm text-ink-muted">AI notes: {state.aiReason}</p>}
      {(state.actions?.length ?? 0) > 0 && (
        <ul className="list-disc pl-5 text-sm">
          {state.actions!.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      )}
      {(state.unfixable?.length ?? 0) > 0 && (
        <Alert tone="warning" title="Can't fix">
          <ul className="list-disc pl-5">
            {state.unfixable!.map((u) => (
              <li key={u}>{u}</li>
            ))}
          </ul>
        </Alert>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <figure>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={state.beforeUrl} alt="Original photo" className="w-full rounded border border-line bg-paper object-contain" />
          <figcaption className="mt-1 text-sm text-ink-muted">Before</figcaption>
        </figure>
        {state.afterUrl && (
          <figure>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={state.afterUrl} alt="Cleaned photo" className="w-full rounded border border-line bg-paper object-contain" />
            <figcaption className="mt-1 text-sm text-ink-muted">After</figcaption>
          </figure>
        )}
      </div>

      {final ? (
        <Alert tone="success" title="Saved">
          <p>{final.message}</p>
          {!final.listingId && final.afterUrl && <p className="mt-1 break-all font-mono text-xs">{final.afterUrl}</p>}
          {final.listingId && <TextLink href={`/app/listings/${final.listingId}`}>Open the listing</TextLink>}
        </Alert>
      ) : (
        state.pendingPath && (
          <form action={approve} className="grid gap-3">
            <input type="hidden" name="requestId" value={state.requestId} />
            <input type="hidden" name="pendingPath" value={state.pendingPath} />
            <input type="hidden" name="listingId" value={state.listingId ?? ""} />
            {state.imageIndex !== null && state.imageIndex !== undefined && <input type="hidden" name="imageIndex" value={state.imageIndex} />}
            <FormMessage state={approved} />
            <div className="flex flex-wrap gap-2">
              <SubmitButton pendingText="Saving…">{state.listingId ? "Approve and replace photo" : "Approve and save"}</SubmitButton>
              <Button
                variant="ghost"
                onClick={async () => {
                  const fd = new FormData();
                  fd.set("pendingPath", state.pendingPath ?? "");
                  fd.set("requestId", state.requestId ?? "");
                  await discardImage(fd);
                  onDone();
                }}
              >
                Discard
              </Button>
            </div>
          </form>
        )
      )}
    </section>
  );
}
