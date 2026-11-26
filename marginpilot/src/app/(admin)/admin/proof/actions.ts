"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath, revalidateTag } from "next/cache";
import { z } from "zod";
import type { ActionState } from "@/components/ui/form";
import { PROOF_CACHE_TAG } from "@/lib/proof";
import { adminContext, audit } from "@/lib/admin/server";
import { normalizeBoxes } from "@/lib/proof-admin/redaction";
import { imageInfo, renderRedacted } from "@/lib/proof-admin/render";
import {
  ALLOWED_IMAGE_TYPES,
  MAX_SCREENSHOT_BYTES,
  canApproveScreenshot,
  fieldErrors,
  isSafeObjectPath,
  moveId,
  screenshotMetaSchema,
  sortOrderUpdates,
  type MoveDirection,
} from "@/lib/proof-admin/rules";
import { BUCKETS, download, removeQuietly, upload, versionSuffix } from "@/lib/proof-admin/storage";

/**
 * Proof screenshots. Originals live in the private proof-originals bucket.
 * Only a server-rendered, pixelated copy is ever written to proof-public, and
 * only on approval. Every change refreshes the public Results section.
 */

type Db = Awaited<ReturnType<typeof adminContext>>["db"];

type ScreenshotRow = {
  id: string;
  original_path: string;
  public_image_path: string | null;
  redactions: unknown;
  caption: string;
  store_label: string;
  range_start: string;
  range_end: string;
  captured_on: string;
  image_width: number | null;
  image_height: number | null;
  status: "pending" | "approved" | "rejected";
  sort_order: number;
};

/**
 * Refresh the public proof cache. Additions use stale-while-revalidate ("max");
 * removals expire immediately so a withdrawn item stops showing on the next request.
 */
function refreshProof(removal = false, id?: string) {
  revalidateTag(PROOF_CACHE_TAG, removal ? { expire: 0 } : "max");
  revalidatePath("/admin/proof");
  if (id) revalidatePath(`/admin/proof/screenshots/${id}`);
  revalidatePath("/admin");
}

async function loadScreenshot(db: Db, id: unknown): Promise<ScreenshotRow | null> {
  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) return null;
  const { data } = await db.from("proof_screenshots").select("*").eq("id", parsed.data).maybeSingle();
  return (data as ScreenshotRow | null) ?? null;
}

// ---------------------------------------------------------------------------
// Upload: the browser sends the file straight to storage with a one-time signed
// upload URL (server actions are capped at 1MB), then we record the row.
// ---------------------------------------------------------------------------

export async function startScreenshotUpload(input: {
  type: string;
  size: number;
}): Promise<{ ok: true; path: string; token: string } | { ok: false; message: string }> {
  const { db } = await adminContext();
  if (!(ALLOWED_IMAGE_TYPES as readonly string[]).includes(input.type)) {
    return { ok: false, message: "Use a PNG, JPEG or WebP image." };
  }
  if (!(input.size > 0) || input.size > MAX_SCREENSHOT_BYTES) {
    return { ok: false, message: "The image must be under 15 MB." };
  }
  const ext = input.type === "image/png" ? "png" : input.type === "image/webp" ? "webp" : "jpg";
  const path = `originals/${new Date().toISOString().slice(0, 7)}/${randomUUID()}.${ext}`;
  const { data, error } = await db.storage.from(BUCKETS.originals).createSignedUploadUrl(path);
  if (error || !data) return { ok: false, message: `Couldn't start the upload: ${error?.message ?? "unknown error"}` };
  return { ok: true, path: data.path, token: data.token };
}

export async function createScreenshot(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState & { id?: string }> {
  const { admin, db } = await adminContext();
  const path = String(formData.get("path") ?? "");
  const parsed = screenshotMetaSchema().safeParse({
    caption: formData.get("caption") ?? "",
    store_label: formData.get("store_label") ?? "",
    range_start: formData.get("range_start") ?? "",
    range_end: formData.get("range_end") ?? "",
    captured_on: formData.get("captured_on") ?? "",
  });
  if (!isSafeObjectPath(path, "originals/")) {
    return { ok: false, message: "Upload the image first." };
  }
  if (!parsed.success) {
    await removeQuietly(db, BUCKETS.originals, [path]);
    return { ok: false, message: "Check the details and upload again.", fieldErrors: fieldErrors(parsed.error) };
  }

  let info: { width: number; height: number };
  try {
    info = await imageInfo(await download(db, BUCKETS.originals, path));
  } catch (err) {
    await removeQuietly(db, BUCKETS.originals, [path]);
    return { ok: false, message: err instanceof Error ? err.message : "That file isn't a readable image." };
  }

  const { data, error } = await db
    .from("proof_screenshots")
    .insert({
      original_path: path,
      ...parsed.data,
      image_width: info.width,
      image_height: info.height,
      status: "pending",
      uploaded_by: admin.id,
    })
    .select("id")
    .single();
  if (error || !data) {
    await removeQuietly(db, BUCKETS.originals, [path]);
    return { ok: false, message: `Couldn't save the screenshot: ${error?.message ?? "unknown error"}` };
  }

  await audit(db, admin.id, "proof_screenshot_upload", { details: { id: data.id } });
  revalidatePath("/admin/proof");
  return { ok: true, message: "Uploaded. Redact it next.", id: data.id as string };
}

// ---------------------------------------------------------------------------
// Details, redaction boxes, approval
// ---------------------------------------------------------------------------

export async function updateScreenshotDetails(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { admin, db } = await adminContext();
  const row = await loadScreenshot(db, formData.get("id"));
  if (!row) return { ok: false, message: "Screenshot not found." };
  const parsed = screenshotMetaSchema().safeParse({
    caption: formData.get("caption") ?? "",
    store_label: formData.get("store_label") ?? "",
    range_start: formData.get("range_start") ?? "",
    range_end: formData.get("range_end") ?? "",
    captured_on: formData.get("captured_on") ?? "",
  });
  if (!parsed.success) return { ok: false, message: "Check the details.", fieldErrors: fieldErrors(parsed.error) };

  const { error } = await db.from("proof_screenshots").update(parsed.data).eq("id", row.id);
  if (error) return { ok: false, message: `Couldn't save: ${error.message}` };
  await audit(db, admin.id, "proof_screenshot_edit", { details: { id: row.id } });
  refreshProof(false, row.id);
  return { ok: true, message: row.status === "approved" ? "Saved. The public page updates shortly." : "Saved." };
}

function readBoxes(formData: FormData, row: ScreenshotRow) {
  let raw: unknown;
  try {
    raw = JSON.parse(String(formData.get("boxes") ?? "[]"));
  } catch {
    throw new Error("The redaction boxes couldn't be read. Reload and try again.");
  }
  return normalizeBoxes(raw, row.image_width ?? 0, row.image_height ?? 0);
}

export async function saveRedactions(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { db } = await adminContext();
  const row = await loadScreenshot(db, formData.get("id"));
  if (!row) return { ok: false, message: "Screenshot not found." };
  let boxes;
  try {
    boxes = readBoxes(formData, row);
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
  const { error } = await db.from("proof_screenshots").update({ redactions: boxes }).eq("id", row.id);
  if (error) return { ok: false, message: `Couldn't save: ${error.message}` };
  revalidatePath(`/admin/proof/screenshots/${row.id}`);
  return {
    ok: true,
    message: `Saved ${boxes.length} box${boxes.length === 1 ? "" : "es"}.${row.status === "approved" ? " Approve again to update the published image." : ""}`,
  };
}

/**
 * Render the redacted copy from the private original on the server, upload it
 * to the public bucket and publish. The unredacted bytes never leave the
 * private bucket.
 */
export async function approveScreenshot(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { admin, db } = await adminContext();
  const row = await loadScreenshot(db, formData.get("id"));
  if (!row) return { ok: false, message: "Screenshot not found." };

  const rule = canApproveScreenshot(row, { piiChecked: formData.get("pii_checked") === "on" });
  if (!rule.ok) return { ok: false, message: rule.reason, fieldErrors: { pii_checked: rule.reason } };

  let boxes;
  try {
    boxes = readBoxes(formData, row);
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }

  let rendered: { data: Buffer; width: number; height: number };
  try {
    rendered = await renderRedacted(await download(db, BUCKETS.originals, row.original_path), boxes);
  } catch (err) {
    return { ok: false, message: `Couldn't render the redacted image: ${(err as Error).message}` };
  }

  const publicPath = `screenshots/${row.id}-${versionSuffix()}.png`;
  try {
    await upload(db, BUCKETS.public, publicPath, rendered.data, "image/png");
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }

  const { error } = await db
    .from("proof_screenshots")
    .update({
      redactions: boxes,
      public_image_path: publicPath,
      image_width: rendered.width,
      image_height: rendered.height,
      status: "approved",
      reviewed_by: admin.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", row.id);
  if (error) {
    await removeQuietly(db, BUCKETS.public, [publicPath]);
    return { ok: false, message: `Couldn't publish: ${error.message}` };
  }
  if (row.public_image_path && row.public_image_path !== publicPath) {
    await removeQuietly(db, BUCKETS.public, [row.public_image_path]);
  }

  await audit(db, admin.id, "proof_screenshot_approve", { details: { id: row.id, boxes: boxes.length } });
  refreshProof(!!row.public_image_path, row.id);
  return { ok: true, message: "Approved and published. The public Results section updates shortly." };
}

/** Take it off the public site: clear the public copy first in the DB, then delete the file. */
async function takeDown(db: Db, row: ScreenshotRow, status: "pending" | "rejected", adminId: string) {
  const { error } = await db
    .from("proof_screenshots")
    .update({ status, public_image_path: null, reviewed_by: adminId, reviewed_at: new Date().toISOString() })
    .eq("id", row.id);
  if (error) throw new Error(error.message);
  await removeQuietly(db, BUCKETS.public, [row.public_image_path]);
}

export async function rejectScreenshot(formData: FormData): Promise<void> {
  const { admin, db } = await adminContext();
  const row = await loadScreenshot(db, formData.get("id"));
  if (!row) return;
  await takeDown(db, row, "rejected", admin.id);
  await audit(db, admin.id, "proof_screenshot_reject", { details: { id: row.id } });
  refreshProof(true, row.id);
}

export async function unpublishScreenshot(formData: FormData): Promise<void> {
  const { admin, db } = await adminContext();
  const row = await loadScreenshot(db, formData.get("id"));
  if (!row) return;
  await takeDown(db, row, "pending", admin.id);
  await audit(db, admin.id, "proof_screenshot_unpublish", { details: { id: row.id } });
  refreshProof(true, row.id);
}

export async function deleteScreenshot(formData: FormData): Promise<void> {
  const { admin, db } = await adminContext();
  const row = await loadScreenshot(db, formData.get("id"));
  if (!row) return;
  const { error } = await db.from("proof_screenshots").delete().eq("id", row.id);
  if (error) throw new Error(error.message);
  await removeQuietly(db, BUCKETS.public, [row.public_image_path]);
  await removeQuietly(db, BUCKETS.originals, [row.original_path]);
  await audit(db, admin.id, "proof_screenshot_delete", { details: { id: row.id } });
  refreshProof(true);
}

const DIRECTIONS = ["up", "down", "top", "bottom"] as const;

/** Reorder within the item's status group, in the same order the public section uses. */
export async function moveScreenshot(formData: FormData): Promise<void> {
  const { db } = await adminContext();
  const row = await loadScreenshot(db, formData.get("id"));
  const dir = String(formData.get("direction")) as MoveDirection;
  if (!row || !(DIRECTIONS as readonly string[]).includes(dir)) return;

  const { data } = await db
    .from("proof_screenshots")
    .select("id, sort_order")
    .eq("status", row.status)
    .order("sort_order", { ascending: true })
    .order("captured_on", { ascending: false })
    .limit(1000);
  const rows = (data ?? []) as { id: string; sort_order: number }[];
  const updates = sortOrderUpdates(rows, moveId(rows.map((r) => r.id), row.id, dir));
  await Promise.all(updates.map((u) => db.from("proof_screenshots").update({ sort_order: u.sort_order }).eq("id", u.id)));
  if (row.status === "approved") refreshProof(false);
  else revalidatePath("/admin/proof");
}
