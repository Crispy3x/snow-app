"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStore } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertWithinLimit, PlanLimitError } from "@/lib/limits";
import { makeSku } from "@/lib/lister/pricing";
import { loadStoreRules } from "@/lib/lister/store";
import { moveImage, removeImage, signedUrl, uploadImage } from "@/lib/lister/storage";
import { buildListingRow, floorPrice, parseSpecifics, type PhotoDraft } from "@/lib/photo-studio/draft";
import { PhotoroomError, PHOTOROOM_MESSAGES, photoroomConfigured, removeBackground, sceneBackground, SCENES, SCENE_KEYS, type SceneKey } from "@/lib/photo-studio/photoroom";
import {
  downloadImage,
  generatePhotoDraft,
  isPendingPath,
  loadJob,
  MAX_UPLOAD_BYTES,
  normaliseUpload,
  removeImages,
  type StudioJob,
  type StudioResult,
} from "@/lib/photo-studio/studio";
import { borderStats, loadRgb, toSquareJpeg, whiteBackground } from "@/lib/photo-studio/white";

const PREVIEW_SECONDS = 60 * 60;
const MAX_RESULTS = 8;

export type ClientImage = { id: string; label: string; kind: "source" | StudioResult["kind"]; url: string };

export type ClientJob = {
  id: string;
  images: ClientImage[];
  draft: PhotoDraft | null;
  requestId: string | null;
  cost: number | null;
  shipping: number | null;
  floorPrice: number | null;
  floorReasons: string[];
  plainBackground: boolean;
};

export type StudioState = { ok?: boolean; message?: string; job?: ClientJob } | null;
export type ImagesState = { ok?: boolean; message?: string; images?: ClientImage[] } | null;
export type DraftState = { ok?: boolean; message?: string; draft?: PhotoDraft; requestId?: string } | null;
export type CreateState = { ok?: boolean; message?: string; listingId?: string } | null;

const optionalMoney = z
  .string()
  .trim()
  .transform((s) => (s === "" ? null : Number(s)))
  .refine((n) => n === null || (Number.isFinite(n) && n >= 0 && n < 1_000_000), "Enter a valid amount.");

async function clientImages(job: Pick<StudioJob, "source_path" | "results">): Promise<ClientImage[]> {
  const source: ClientImage = { id: "source", label: "Original", kind: "source", url: await signedUrl(job.source_path, PREVIEW_SECONDS) };
  const results = await Promise.all(
    (job.results ?? []).map(async (r) => ({ id: r.id, label: r.label, kind: r.kind, url: await signedUrl(r.path, PREVIEW_SECONDS) })),
  );
  return [source, ...results];
}

/** Upload the photo, start a studio job and (optionally) write the AI listing draft. */
export async function startStudio(_prev: StudioState, formData: FormData): Promise<StudioState> {
  const ctx = await requireStore();
  const file = formData.get("photo");
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Choose a product photo." };
  if (file.size > MAX_UPLOAD_BYTES) return { ok: false, message: "That photo is too large. Try a smaller one (it's shrunk in your browser first, so this is rare)." };
  const parsed = z
    .object({ notes: z.string().max(2000, "Keep notes under 2,000 characters."), cost: optionalMoney, shipping: optionalMoney })
    .safeParse({ notes: String(formData.get("notes") ?? ""), cost: String(formData.get("cost") ?? ""), shipping: String(formData.get("shipping") ?? "") });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the fields." };
  const { notes, cost, shipping } = parsed.data;
  const writeDraft = formData.get("writeDraft") === "on";

  let image: Buffer;
  try {
    image = await normaliseUpload(Buffer.from(await file.arrayBuffer()));
  } catch (e) {
    return { ok: false, message: e instanceof Error && e.message.startsWith("Upload") ? e.message : "That file couldn't be read as an image." };
  }

  const sourcePath = `${ctx.org.id}/pending/${randomUUID()}.jpg`;
  const db = createAdminClient();
  try {
    await uploadImage(sourcePath, image);
  } catch {
    return { ok: false, message: "Couldn't store the photo. Please try again." };
  }
  const { data: jobRow, error } = await db
    .from("photo_studio_jobs")
    .insert({ org_id: ctx.org.id, store_id: ctx.store.id, user_id: ctx.user.id, source_path: sourcePath, cost, shipping_cost: cost !== null ? (shipping ?? 0) : null })
    .select("id")
    .single();
  if (error || !jobRow) {
    await removeImage(sourcePath);
    return { ok: false, message: "Couldn't start the photo studio. Please try again." };
  }
  const jobId = jobRow.id as string;

  const [rules, stats] = await Promise.all([loadStoreRules(ctx.store.id), loadRgb(image, 600).then((raw) => borderStats(raw))]);
  const floor = floorPrice(cost, shipping, rules);

  let draft: PhotoDraft | null = null;
  let requestId: string | null = null;
  let message = "Photo uploaded. Pick a background below, then create the listing.";
  let ok = true;
  if (writeDraft) {
    const res = await generatePhotoDraft({ orgId: ctx.org.id, userId: ctx.user.id, storeId: ctx.store.id, image, notes, sourcePath });
    if (res.ok) {
      draft = res.draft;
      requestId = res.requestId;
      message = "Draft ready. Review the listing, choose photos to keep, then create the draft listing.";
      await db.from("photo_studio_jobs").update({ draft, ai_request_id: requestId, updated_at: new Date().toISOString() }).eq("id", jobId).eq("org_id", ctx.org.id);
    } else {
      ok = false;
      message = `${res.message} Your photo was kept, so you can still use the background tools or try the draft again.`;
    }
  }

  return {
    ok,
    message,
    job: {
      id: jobId,
      images: await clientImages({ source_path: sourcePath, results: [] }),
      draft,
      requestId,
      cost,
      shipping: cost !== null ? (shipping ?? 0) : null,
      floorPrice: floor.price,
      floorReasons: floor.reasons,
      plainBackground: stats.uniform,
    },
  };
}

const jobIdSchema = z.string().uuid();

/** Write (or rewrite) the AI draft for an existing job. */
export async function writeJobDraft(_prev: DraftState, formData: FormData): Promise<DraftState> {
  const ctx = await requireStore();
  const jobId = String(formData.get("jobId") ?? "");
  if (!jobIdSchema.safeParse(jobId).success) return { ok: false, message: "Upload the photo again." };
  const notes = String(formData.get("notes") ?? "").slice(0, 2000);
  const job = await loadJob(jobId, ctx.org.id);
  if (!job || job.status !== "draft") return { ok: false, message: "This photo session has ended. Upload the photo again." };
  let image: Buffer;
  try {
    image = await downloadImage(job.source_path);
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "The photo is no longer available." };
  }
  const res = await generatePhotoDraft({ orgId: ctx.org.id, userId: ctx.user.id, storeId: ctx.store.id, image, notes, sourcePath: job.source_path });
  if (!res.ok) return { ok: false, message: res.message };
  const db = createAdminClient();
  if (job.ai_request_id) await db.from("ai_requests").update({ draft_status: "rejected" }).eq("id", job.ai_request_id).eq("org_id", ctx.org.id);
  await db.from("photo_studio_jobs").update({ draft: res.draft, ai_request_id: res.requestId, updated_at: new Date().toISOString() }).eq("id", job.id).eq("org_id", ctx.org.id);
  return { ok: true, message: "Draft ready.", draft: res.draft, requestId: res.requestId };
}

const modeSchema = z.union([z.literal("local_white"), z.literal("remove_bg"), z.string().regex(/^scene:[a-z_]+$/)]);

/** Make a background variant: local white (sharp) or Photoroom removal / scene. */
export async function addBackground(_prev: ImagesState, formData: FormData): Promise<ImagesState> {
  const ctx = await requireStore();
  const jobId = String(formData.get("jobId") ?? "");
  const mode = modeSchema.safeParse(String(formData.get("mode") ?? ""));
  if (!jobIdSchema.safeParse(jobId).success || !mode.success) return { ok: false, message: "Choose a background option." };
  const job = await loadJob(jobId, ctx.org.id);
  if (!job || job.status !== "draft") return { ok: false, message: "This photo session has ended. Upload the photo again." };
  if ((job.results ?? []).length >= MAX_RESULTS) return { ok: false, message: `You can make up to ${MAX_RESULTS} versions per photo. Discard and start again for more.` };

  let source: Buffer;
  try {
    source = await downloadImage(job.source_path);
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "The photo is no longer available." };
  }

  let output: Buffer;
  let kind: StudioResult["kind"];
  let label: string;
  if (mode.data === "local_white") {
    const res = await whiteBackground(source);
    if (!res.ok) return { ok: false, message: res.reason };
    output = res.output;
    kind = "local_white";
    label = "Clean white";
  } else {
    if (!photoroomConfigured()) return { ok: false, message: PHOTOROOM_MESSAGES.not_configured };
    try {
      if (mode.data === "remove_bg") {
        output = await removeBackground(source);
        kind = "remove_bg";
        label = "Background removed";
      } else {
        const scene = mode.data.slice("scene:".length) as SceneKey;
        if (!SCENE_KEYS.includes(scene)) return { ok: false, message: "Choose a scene." };
        output = await sceneBackground(source, scene);
        kind = "scene";
        label = SCENES[scene].label;
      }
    } catch (e) {
      return { ok: false, message: e instanceof PhotoroomError ? e.message : PHOTOROOM_MESSAGES.failed };
    }
  }

  // Square white canvas, JPEG, 1600px whatever the source returned. Cut-outs get a margin.
  try {
    if (kind !== "local_white") output = await toSquareJpeg(output, { margin: kind === "remove_bg" ? 0.08 : 0 });
  } catch {
    return { ok: false, message: "The edited photo couldn't be read. Please try again." };
  }

  const result: StudioResult = { id: randomUUID(), kind, label, path: `${ctx.org.id}/pending/${randomUUID()}.jpg` };
  try {
    await uploadImage(result.path, output);
  } catch {
    return { ok: false, message: "Couldn't store the edited photo. Please try again." };
  }
  const results = [...(job.results ?? []), result];
  await createAdminClient().from("photo_studio_jobs").update({ results, updated_at: new Date().toISOString() }).eq("id", job.id).eq("org_id", ctx.org.id);
  return { ok: true, message: `${label} version added.`, images: await clientImages({ source_path: job.source_path, results }) };
}

const createSchema = z.object({
  jobId: z.string().uuid(),
  title: z.string().trim().min(10, "Titles need at least 10 characters.").max(80, "eBay titles are at most 80 characters."),
  description: z.string().min(1, "Add a description.").max(50_000),
  specifics: z.string().max(20_000).default(""),
  price: optionalMoney,
  cost: optionalMoney,
  shipping: optionalMoney,
  quantity: z.coerce.number().int().min(0).max(10_000),
});

/** Keep the chosen images, insert the draft listing and close the job. */
export async function createListingFromStudio(_prev: CreateState, formData: FormData): Promise<CreateState> {
  const ctx = await requireStore();
  const parsed = createSchema.safeParse({
    jobId: formData.get("jobId"),
    title: formData.get("title"),
    description: formData.get("description"),
    specifics: formData.get("specifics") ?? "",
    price: String(formData.get("price") ?? ""),
    cost: String(formData.get("cost") ?? ""),
    shipping: String(formData.get("shipping") ?? ""),
    quantity: formData.get("quantity") ?? 1,
  });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the fields." };
  const d = parsed.data;
  const keep = new Set(formData.getAll("keep").map(String));
  if (!keep.size) return { ok: false, message: "Choose at least one photo to keep." };

  const job = await loadJob(d.jobId, ctx.org.id);
  if (!job || job.status !== "draft") return { ok: false, message: "This photo session has ended. Upload the photo again." };

  try {
    await assertWithinLimit(ctx.org.id, "listings", 1);
  } catch (e) {
    if (e instanceof PlanLimitError) return { ok: false, message: e.message };
    throw e;
  }

  const all: { id: string; path: string }[] = [{ id: "source", path: job.source_path }, ...(job.results ?? []).map((r) => ({ id: r.id, path: r.path }))];
  // Kept images in the order shown, with chosen edits before the original (first photo is the eBay main image).
  const kept = [...all.filter((a) => a.id !== "source" && keep.has(a.id)), ...all.filter((a) => a.id === "source" && keep.has("source"))];
  if (!kept.length) return { ok: false, message: "Choose at least one photo to keep." };
  if (kept.some((k) => !isPendingPath(k.path, ctx.org.id))) return { ok: false, message: "Image not found." };

  const rules = await loadStoreRules(ctx.store.id);
  const listingId = randomUUID();
  const mapped = buildListingRow({
    id: listingId,
    orgId: ctx.org.id,
    storeId: ctx.store.id,
    sku: makeSku(),
    input: {
      title: d.title,
      description: d.description,
      specifics: parseSpecifics(d.specifics),
      price: d.price,
      cost: d.cost,
      shipping: d.shipping,
      quantity: d.quantity,
    },
    images: [],
    rules,
    aiVero: job.draft?.vero ?? null,
  });
  if (!mapped.ok) return { ok: false, message: mapped.message };

  // Move kept images under the listing and sign long-lived URLs (see lister/storage.ts).
  const moved: string[] = [];
  const images: string[] = [];
  try {
    for (const k of kept) {
      const to = `${ctx.org.id}/${listingId}/${randomUUID()}.jpg`;
      await moveImage(k.path, to);
      moved.push(to);
      images.push(await signedUrl(to));
    }
  } catch (e) {
    await removeImages(moved);
    return { ok: false, message: e instanceof Error ? e.message : "Couldn't save the photos." };
  }

  const db = createAdminClient();
  const { error } = await db.from("listings").insert({ ...mapped.row, images });
  if (error) {
    await removeImages(moved);
    return { ok: false, message: "Couldn't save the draft listing. Please try again." };
  }

  const keptPaths = new Set(kept.map((k) => k.path));
  await removeImages(all.map((a) => a.path).filter((p) => !keptPaths.has(p) && isPendingPath(p, ctx.org.id)));
  await db
    .from("photo_studio_jobs")
    .update({ status: "applied", listing_id: listingId, cost: d.cost, shipping_cost: d.cost !== null ? (d.shipping ?? 0) : null, updated_at: new Date().toISOString() })
    .eq("id", job.id)
    .eq("org_id", ctx.org.id);
  if (job.ai_request_id) await db.from("ai_requests").update({ draft_status: "applied" }).eq("id", job.ai_request_id).eq("org_id", ctx.org.id);

  revalidatePath("/app/listings");
  const guard = mapped.guard;
  return {
    ok: true,
    listingId,
    message: !guard
      ? "Saved as a draft listing. Add your item cost before publishing so the margin guard can check it."
      : guard.ok
        ? "Saved as a draft listing."
        : `Saved, but blocked by the margin guard: ${guard.reasons.join(" ")}`,
  };
}

/** Throw the session away: delete its pending files and mark the AI draft rejected. */
export async function discardStudio(formData: FormData) {
  const ctx = await requireStore();
  const jobId = String(formData.get("jobId") ?? "");
  if (!jobIdSchema.safeParse(jobId).success) return;
  const job = await loadJob(jobId, ctx.org.id);
  if (!job || job.status !== "draft") return;
  await removeImages([job.source_path, ...(job.results ?? []).map((r) => r.path)].filter((p) => isPendingPath(p, ctx.org.id)));
  const db = createAdminClient();
  await db.from("photo_studio_jobs").update({ status: "discarded", updated_at: new Date().toISOString() }).eq("id", job.id).eq("org_id", ctx.org.id);
  if (job.ai_request_id) await db.from("ai_requests").update({ draft_status: "rejected" }).eq("id", job.ai_request_id).eq("org_id", ctx.org.id);
}
