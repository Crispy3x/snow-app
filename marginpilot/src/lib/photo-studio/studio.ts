import "server-only";
import sharp from "sharp";
import { runAi } from "@/lib/ai/run";
import { createAdminClient } from "@/lib/supabase/admin";
import { BUCKET } from "@/lib/lister/storage";
import { finishPhotoDraft, photoDraftSchema, photoPrompt, PHOTO_SYSTEM, type PhotoDraft } from "./draft";

/**
 * Server side of the photo studio: job rows, pending files and the vision call.
 * Files live in the private listing-images bucket (see src/lib/lister/storage.ts):
 *  - <org>/pending/<uuid>.jpg for the upload and every background variant,
 *  - moved to <org>/<listing>/<uuid>.jpg with a long-lived signed URL when kept.
 */

export type StudioResult = { id: string; kind: "local_white" | "remove_bg" | "scene"; label: string; path: string };

export type StudioJob = {
  id: string;
  org_id: string;
  store_id: string | null;
  source_path: string;
  results: StudioResult[];
  draft: PhotoDraft | null;
  ai_request_id: string | null;
  cost: number | string | null;
  shipping_cost: number | string | null;
  status: "draft" | "applied" | "discarded";
  listing_id: string | null;
};

const JOB_COLUMNS = "id, org_id, store_id, source_path, results, draft, ai_request_id, cost, shipping_cost, status, listing_id";

/** Max bytes accepted from the browser (the client downscales to <=1600px JPEG first). */
export const MAX_UPLOAD_BYTES = 950 * 1024;

export function isPendingPath(path: string, orgId: string): boolean {
  return path.startsWith(`${orgId}/pending/`) && !path.includes("..");
}

export async function loadJob(jobId: string, orgId: string): Promise<StudioJob | null> {
  const { data } = await createAdminClient().from("photo_studio_jobs").select(JOB_COLUMNS).eq("id", jobId).eq("org_id", orgId).maybeSingle();
  return (data as StudioJob | null) ?? null;
}

export async function downloadImage(path: string): Promise<Buffer> {
  const { data, error } = await createAdminClient().storage.from(BUCKET).download(path);
  if (error || !data) throw new Error("The photo is no longer available. Upload it again.");
  return Buffer.from(await data.arrayBuffer());
}

export async function removeImages(paths: string[]) {
  const list = paths.filter(Boolean);
  if (list.length) await createAdminClient().storage.from(BUCKET).remove(list);
}

/** Re-encode an upload: EXIF orientation applied, <=1600px, JPEG. Throws on non-images. */
export async function normaliseUpload(input: Buffer): Promise<Buffer> {
  const meta = await sharp(input).metadata();
  if (!meta.format || !["jpeg", "png", "webp", "heif", "avif"].includes(meta.format)) throw new Error("Upload a JPEG, PNG or WebP photo.");
  return sharp(input)
    .rotate()
    .flatten({ background: "#ffffff" })
    .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer();
}

export async function generatePhotoDraft(opts: {
  orgId: string;
  userId: string | null;
  storeId: string | null;
  image: Buffer;
  notes?: string;
  sourcePath: string;
}): Promise<{ ok: true; draft: PhotoDraft; requestId: string } | { ok: false; message: string; requestId?: string }> {
  // Claude's vision input works best at <=1568px on the long side.
  const forAi = await sharp(opts.image).resize({ width: 1568, height: 1568, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
  const prompt = photoPrompt({ notes: opts.notes });
  const res = await runAi({
    orgId: opts.orgId,
    userId: opts.userId,
    storeId: opts.storeId,
    tool: "photo_studio",
    system: PHOTO_SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: forAi.toString("base64") } },
          { type: "text", text: prompt },
        ],
      },
    ],
    logPrompt: { system: PHOTO_SYSTEM, text: prompt, image: `${BUCKET}/${opts.sourcePath}` },
    schema: photoDraftSchema,
    maxTokens: 3000,
    effort: "medium",
  });
  if (!res.ok) return { ok: false, message: res.message, requestId: res.requestId };
  return { ok: true, draft: finishPhotoDraft(res.output, { notes: opts.notes }), requestId: res.requestId };
}
