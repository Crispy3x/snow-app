"use client";

import { startTransition, useActionState, useMemo, useState } from "react";
import { guardPrice, type GuardRules } from "@/lib/margin";
import { priceListing } from "@/lib/lister/pricing";
import type { PhotoDraft } from "@/lib/photo-studio/draft";
import { Alert, TextLink, money } from "@/components/ui/app";
import { Button } from "@/components/ui/button";
import { Checkbox, FormMessage, TextArea, TextInput } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import { downscalePhoto, DownscaleError } from "@/components/photo-studio/downscale";
import { PhotoGrid } from "@/components/photo-studio/photo-grid";
import {
  addBackground,
  createListingFromStudio,
  discardStudio,
  startStudio,
  writeJobDraft,
  type ClientImage,
  type ClientJob,
  type CreateState,
  type DraftState,
  type ImagesState,
  type StudioState,
} from "./actions";

type Scene = { key: string; label: string };

export function PhotoStudio({ rules, photoroomEnabled, scenes, credits }: { rules: GuardRules; photoroomEnabled: boolean; scenes: Scene[]; credits: number }) {
  const [state, action, pending] = useActionState<StudioState, FormData>(startStudio, null);
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const job = state?.job && state.job.id !== dismissed ? state.job : null;

  async function onPick(file: File | undefined) {
    setPickError(null);
    setPhoto(null);
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
    if (!file) return;
    setPreparing(true);
    try {
      const small = await downscalePhoto(file);
      setPhoto(small);
      setPreview(URL.createObjectURL(small));
    } catch (e) {
      setPickError(e instanceof DownscaleError ? e.message : "Couldn't prepare that photo.");
    } finally {
      setPreparing(false);
    }
  }

  if (job) {
    return (
      <div className="grid gap-6">
        {state?.message && <FormMessage state={{ ok: state.ok, message: state.message }} />}
        <Studio key={job.id} job={job} rules={rules} photoroomEnabled={photoroomEnabled} scenes={scenes} onClose={() => setDismissed(job.id)} />
      </div>
    );
  }

  return (
    <form
      className="grid gap-4 rounded-lg border border-line bg-card p-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!photo) {
          setPickError("Choose a product photo.");
          return;
        }
        const fd = new FormData(e.currentTarget);
        fd.delete("photo-file"); // the original full-size file; only the downscaled copy is sent
        fd.set("photo", photo);
        startTransition(() => action(fd));
      }}
    >
      <div className="grid gap-4 md:grid-cols-[1fr_200px]">
        <div className="grid gap-4">
          <TextInput
            id="photo-file"
            name="photo-file"
            label="Product photo"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            required
            onChange={(e) => onPick(e.target.files?.[0])}
            error={pickError ?? undefined}
            hint="One clear photo of the product. It's resized in your browser to 1600px before upload."
          />
          <TextArea
            id="notes"
            label="Notes for the AI (optional)"
            rows={3}
            maxLength={2000}
            placeholder="e.g. Unbranded, stainless steel, pack of 2, new in box"
            hint="Anything the photo doesn't show: material, size, quantity, brand status."
          />
        </div>
        {preview && (
          <figure className="self-start">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview} alt="Selected photo preview" className="aspect-square w-full max-w-[200px] rounded border border-line bg-paper object-contain" />
            <figcaption className="mt-1 text-sm text-ink-muted">Preview</figcaption>
          </figure>
        )}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextInput id="cost" label="Item cost (USD, optional)" type="number" step="0.01" min="0" inputMode="decimal" hint="Used to price at your margin floor." />
        <TextInput id="shipping" label="Supplier shipping (USD, optional)" type="number" step="0.01" min="0" inputMode="decimal" />
      </div>
      <Checkbox id="writeDraft" label="Write the listing with AI" defaultChecked hint={`Uses ${credits} AI credits. Untick to only edit the background.`} />
      {state && !state.ok && <FormMessage state={state} />}
      <div>
        <Button type="submit" disabled={pending || preparing}>
          {pending ? "Uploading and writing…" : preparing ? "Preparing photo…" : "Upload photo"}
        </Button>
      </div>
    </form>
  );
}

function Studio({ job, rules, photoroomEnabled, scenes, onClose }: { job: ClientJob; rules: GuardRules; photoroomEnabled: boolean; scenes: Scene[]; onClose: () => void }) {
  const [imgState, imgAction, imgPending] = useActionState<ImagesState, FormData>(addBackground, null);
  const [draftState, draftAction] = useActionState<DraftState, FormData>(writeJobDraft, null);
  const images: ClientImage[] = imgState?.images ?? job.images;
  const [kept, setKept] = useState<Set<string>>(() => new Set(["source"]));
  const [seen, setSeen] = useState<number>(job.images.length);
  // Newly made versions start as kept (the first kept edit becomes the main photo).
  if (images.length !== seen) {
    setSeen(images.length);
    setKept((k) => new Set([...k, ...images.slice(seen).map((i) => i.id)]));
  }
  const draft = draftState?.draft ?? job.draft;
  const createFormId = `create-${job.id}`;

  return (
    <>
      <section aria-labelledby="photos-heading" className="grid gap-4 rounded-lg border border-line bg-card p-5">
        <div>
          <h2 id="photos-heading" className="text-lg font-semibold">
            Photos
          </h2>
          <p className="text-sm text-ink-muted">Make background versions, then tick the photos to keep. The first kept edit becomes the main eBay photo.</p>
        </div>
        <PhotoGrid images={images} kept={kept} formId={createFormId} onToggle={(id, on) => setKept((k) => { const n = new Set(k); if (on) n.add(id); else n.delete(id); return n; })} />

        <form action={imgAction} className="grid gap-3">
          <input type="hidden" name="jobId" value={job.id} />
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">Clean white background (free)</legend>
            <p className="text-sm text-ink-muted">
              {job.plainBackground
                ? "Your photo has a plain backdrop, so it can be turned white and centred on a square canvas right here."
                : "The backdrop doesn't look plain, so the free cleaner may refuse. Background removal works on any photo."}
            </p>
            <div>
              <SubmitButton name="mode" value="local_white" variant="secondary" pendingText="Working…">
                Make clean white version
              </SubmitButton>
            </div>
          </fieldset>
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">Background removal and scenes (Photoroom)</legend>
            {photoroomEnabled ? (
              <div className="flex flex-wrap gap-2">
                <SubmitButton name="mode" value="remove_bg" variant="secondary" pendingText="Working…">
                  Remove background
                </SubmitButton>
                {scenes.map((s) => (
                  <SubmitButton key={s.key} name="mode" value={`scene:${s.key}`} variant="secondary" pendingText="Working…">
                    {s.label}
                  </SubmitButton>
                ))}
              </div>
            ) : (
              <Alert title="Connect Photoroom to enable background removal and scenes">
                Add a Photoroom API key as <code className="font-mono">PHOTOROOM_API_KEY</code> on the server to cut products out of any background and place them on a white studio, wooden table, outdoor or flat lay scene. The free white-background option above works without it.
              </Alert>
            )}
          </fieldset>
          <p aria-live="polite" className="sr-only">
            {imgPending ? "Making the new version…" : ""}
          </p>
          <FormMessage state={imgState} />
        </form>
      </section>

      {draft ? (
        <DraftForm key={draftState?.requestId ?? job.requestId ?? "draft"} formId={createFormId} job={job} draft={draft} rules={rules} keptCount={kept.size} onClose={onClose} />
      ) : (
        <section aria-labelledby="draft-heading" className="grid gap-4 rounded-lg border border-line bg-card p-5">
          <h2 id="draft-heading" className="text-lg font-semibold">
            Listing
          </h2>
          <form action={draftAction} className="grid gap-3">
            <input type="hidden" name="jobId" value={job.id} />
            <TextArea id="draft-notes" name="notes" label="Notes for the AI (optional)" rows={3} maxLength={2000} />
            <FormMessage state={draftState} />
            <div className="flex flex-wrap gap-2">
              <SubmitButton pendingText="Writing draft…">Write listing with AI</SubmitButton>
            </div>
          </form>
          <p className="text-sm text-ink-muted">Or write it yourself:</p>
          <DraftForm formId={createFormId} job={job} draft={null} rules={rules} keptCount={kept.size} onClose={onClose} embedded />
        </section>
      )}
    </>
  );
}

function DraftForm({
  formId,
  job,
  draft,
  rules,
  keptCount,
  onClose,
  embedded,
}: {
  formId: string;
  job: ClientJob;
  draft: PhotoDraft | null;
  rules: GuardRules;
  keptCount: number;
  onClose: () => void;
  embedded?: boolean;
}) {
  const [state, action] = useActionState<CreateState, FormData>(createListingFromStudio, null);
  const [title, setTitle] = useState(draft?.title ?? "");
  const [cost, setCost] = useState(job.cost !== null ? String(job.cost) : "");
  const [shipping, setShipping] = useState(job.shipping !== null ? String(job.shipping) : "0");
  const [price, setPrice] = useState(job.floorPrice ? job.floorPrice.toFixed(2) : "");
  const specificsText = useMemo(
    () => Object.entries(draft?.itemSpecifics ?? {}).map(([k, v]) => `${k}: ${v.join(", ")}`).join("\n"),
    [draft],
  );

  const costNum = cost.trim() === "" ? null : Number(cost);
  const floor = useMemo(() => {
    if (costNum === null || !Number.isFinite(costNum) || costNum < 0) return null;
    return priceListing(rules.minNetMarginPct, { supplierCost: costNum, supplierShipping: Number(shipping) || 0 }, rules);
  }, [costNum, shipping, rules]);
  const guard = useMemo(() => {
    const p = Number(price);
    return p > 0 && costNum !== null && costNum >= 0 ? guardPrice(p, { supplierCost: costNum, supplierShipping: Number(shipping) || 0 }, rules) : null;
  }, [price, costNum, shipping, rules]);

  if (state?.ok && state.listingId) {
    return (
      <Alert tone="success" title="Draft listing created">
        <p>{state.message}</p>
        <p className="mt-1">
          <TextLink href={`/app/listings/${state.listingId}`}>Open the listing</TextLink>
        </p>
      </Alert>
    );
  }

  const body = (
    <>
      {draft && draft.vero.risk !== "none" && (
        <Alert tone={draft.vero.risk === "high" ? "danger" : "warning"} title={draft.vero.risk === "high" ? "Brand (VeRO) risk: high" : "Brand (VeRO) risk: low"}>
          {draft.vero.brandsMentioned.length > 0 && <p>Brands or trademarks found: {draft.vero.brandsMentioned.join(", ")}</p>}
          <ul className="mt-1 list-disc pl-5">
            {draft.vero.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </Alert>
      )}
      {draft && (
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="font-medium">Condition guess</dt>
            <dd className="text-ink-muted">
              {draft.condition}
              {draft.conditionNotes ? `: ${draft.conditionNotes}` : ""}
            </dd>
          </div>
          <div>
            <dt className="font-medium">Category search keywords</dt>
            <dd className="text-ink-muted">{draft.categoryKeywords.length ? draft.categoryKeywords.join(", ") : "None suggested"}</dd>
          </div>
        </dl>
      )}

      <form id={formId} action={action} className="grid gap-4">
        <input type="hidden" name="jobId" value={job.id} />
        <TextInput id="title" label="Title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} required hint={`${title.length} of 80 characters`} />
        <TextArea id="description" label="Description" defaultValue={draft?.description ?? ""} rows={8} required hint="Simple HTML. Links and contact details are removed on save." />
        <TextArea id="specifics" label="Item specifics" defaultValue={specificsText} rows={5} hint='One per line, like "Material: Bamboo". Separate several values with commas.' />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <TextInput id="create-cost" name="cost" label="Item cost (USD)" type="number" step="0.01" min="0" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} />
          <TextInput id="create-shipping" name="shipping" label="Supplier shipping (USD)" type="number" step="0.01" min="0" inputMode="decimal" value={shipping} onChange={(e) => setShipping(e.target.value)} />
          <TextInput id="price" label="Price (USD)" type="number" step="0.01" min="0.01" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} hint="Blank uses the floor price." />
          <TextInput id="quantity" label="Quantity" type="number" step="1" min="0" defaultValue={1} required />
        </div>
        <div aria-live="polite" className="grid gap-2 text-sm">
          {floor?.price ? (
            <p className="flex flex-wrap items-center gap-2">
              <span>
                Price at your {rules.minNetMarginPct}% margin floor: <strong className="tabular-nums">{money(floor.price)}</strong>
              </span>
              <Button variant="ghost" className="min-h-8 px-2 text-sm underline" onClick={() => setPrice(floor.price!.toFixed(2))}>
                Use this price
              </Button>
            </p>
          ) : floor && !floor.ok ? (
            <p className="text-danger">{floor.reasons.join(" ")}</p>
          ) : (
            <p className="text-ink-muted">Enter your item cost to see the price at your {rules.minNetMarginPct}% margin floor. Without a cost the margin isn&apos;t checked.</p>
          )}
          {guard && (
            <p className={guard.ok ? "text-ink-muted" : "text-danger"}>
              {guard.ok
                ? `Net margin ${guard.breakdown.marginPct.toFixed(1)}% at the worst-case ad rate (profit ${money(guard.breakdown.net)}).`
                : `${guard.reasons.join(" ")}${guard.suggestedPrice ? ` Lowest passing price: ${money(guard.suggestedPrice)}.` : ""} It can be saved but will be blocked from publishing.`}
            </p>
          )}
        </div>
        {keptCount === 0 && <p className="text-sm text-danger">Tick at least one photo to keep.</p>}
        <FormMessage state={state} />
        <div className="flex flex-wrap gap-2">
          <SubmitButton pendingText="Creating…" {...(keptCount === 0 ? { disabled: true } : {})}>
            Create draft listing
          </SubmitButton>
          <Button
            variant="ghost"
            onClick={async () => {
              const fd = new FormData();
              fd.set("jobId", job.id);
              await discardStudio(fd);
              onClose();
            }}
          >
            Discard
          </Button>
        </div>
      </form>
    </>
  );

  if (embedded) return <div className="grid gap-4">{body}</div>;
  return (
    <section aria-labelledby="draft-heading" className="grid gap-4 rounded-lg border border-line bg-card p-5">
      <div className="flex flex-col gap-1">
        <h2 id="draft-heading" className="text-lg font-semibold">
          Listing draft
        </h2>
        <p className="text-sm text-ink-muted">{draft ? `AI-written from your photo${draft.productSummary ? `: ${draft.productSummary}` : ""}. Nothing is saved until you create the listing.` : "Nothing is saved until you create the listing."}</p>
      </div>
      {body}
    </section>
  );
}
