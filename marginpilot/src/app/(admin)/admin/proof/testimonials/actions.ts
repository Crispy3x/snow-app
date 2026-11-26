"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath, revalidateTag } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { ActionState } from "@/components/ui/form";
import { PROOF_CACHE_TAG } from "@/lib/proof";
import { adminContext, audit } from "@/lib/admin/server";
import { renderAvatar } from "@/lib/proof-admin/render";
import { MAX_PHOTO_BYTES, canApproveTestimonial, fieldErrors, moveId, sortOrderUpdates, testimonialSchema, type MoveDirection } from "@/lib/proof-admin/rules";
import { BUCKETS, download, removeQuietly, upload, versionSuffix } from "@/lib/proof-admin/storage";

/**
 * Testimonials: admin-entered and customer-submitted. Nothing is public until
 * approved, and approval requires permission_given (also a DB check).
 */

type Db = Awaited<ReturnType<typeof adminContext>>["db"];

type TestimonialRow = {
  id: string;
  name: string;
  quote: string;
  store_type: string;
  photo_path: string | null;
  photo_public_path: string | null;
  permission_given: boolean;
  given_on: string;
  source: "admin" | "customer";
  status: "pending" | "approved" | "rejected";
  sort_order: number;
};

function refreshProof(removal = false, id?: string) {
  revalidateTag(PROOF_CACHE_TAG, removal ? { expire: 0 } : "max");
  revalidatePath("/admin/proof/testimonials");
  if (id) revalidatePath(`/admin/proof/testimonials/${id}`);
  revalidatePath("/admin");
}

async function loadTestimonial(db: Db, id: unknown): Promise<TestimonialRow | null> {
  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) return null;
  const { data } = await db.from("testimonials").select("*").eq("id", parsed.data).maybeSingle();
  return (data as TestimonialRow | null) ?? null;
}

function readFields(formData: FormData) {
  return testimonialSchema().safeParse({
    name: formData.get("name") ?? "",
    quote: formData.get("quote") ?? "",
    store_type: formData.get("store_type") ?? "",
    given_on: formData.get("given_on") ?? "",
    permission_given: formData.get("permission_given") === "on",
  });
}

/** Re-encode an uploaded photo (strips metadata) and store it privately. Returns the path, or null if none was sent. */
async function storePhoto(db: Db, formData: FormData): Promise<string | null> {
  const file = formData.get("photo");
  if (!(file instanceof File) || file.size === 0) return null;
  if (file.size > MAX_PHOTO_BYTES) throw new Error("The photo is too large. Choose a smaller image.");
  const jpeg = await renderAvatar(Buffer.from(await file.arrayBuffer())).catch(() => {
    throw new Error("The photo couldn't be read. Use a JPEG, PNG or WebP image.");
  });
  const path = `admin/${randomUUID()}.jpg`;
  await upload(db, BUCKETS.uploads, path, jpeg, "image/jpeg");
  return path;
}

/** Copy the private photo to the public bucket (re-encoded again, so only a clean JPEG goes public). */
async function publishPhoto(db: Db, row: TestimonialRow): Promise<string | null> {
  if (!row.photo_path) return null;
  const jpeg = await renderAvatar(await download(db, BUCKETS.uploads, row.photo_path));
  const path = `testimonials/${row.id}-${versionSuffix()}.jpg`;
  await upload(db, BUCKETS.public, path, jpeg, "image/jpeg");
  return path;
}

export async function createTestimonial(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { admin, db } = await adminContext();
  const parsed = readFields(formData);
  if (!parsed.success) return { ok: false, message: "Check the form.", fieldErrors: fieldErrors(parsed.error) };

  let photoPath: string | null;
  try {
    photoPath = await storePhoto(db, formData);
  } catch (err) {
    return { ok: false, message: (err as Error).message, fieldErrors: { photo: (err as Error).message } };
  }

  const { data, error } = await db
    .from("testimonials")
    .insert({ ...parsed.data, photo_path: photoPath, source: "admin", status: "pending", submitted_by: admin.id })
    .select("id")
    .single();
  if (error || !data) {
    await removeQuietly(db, BUCKETS.uploads, [photoPath]);
    return { ok: false, message: `Couldn't save: ${error?.message ?? "unknown error"}` };
  }
  await audit(db, admin.id, "proof_testimonial_create", { details: { id: data.id } });
  revalidatePath("/admin/proof/testimonials");
  return {
    ok: true,
    message: parsed.data.permission_given
      ? "Saved to the queue. Approve it there to publish."
      : "Saved as a draft. It can't be approved until permission is recorded.",
  };
}

export async function updateTestimonial(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { admin, db } = await adminContext();
  const row = await loadTestimonial(db, formData.get("id"));
  if (!row) return { ok: false, message: "Testimonial not found." };
  const parsed = readFields(formData);
  if (!parsed.success) return { ok: false, message: "Check the form.", fieldErrors: fieldErrors(parsed.error) };

  let newPhoto: string | null;
  try {
    newPhoto = await storePhoto(db, formData);
  } catch (err) {
    return { ok: false, message: (err as Error).message, fieldErrors: { photo: (err as Error).message } };
  }
  const removePhoto = formData.get("remove_photo") === "on";
  const photoPath = newPhoto ?? (removePhoto ? null : row.photo_path);
  const photoChanged = photoPath !== row.photo_path;

  const update: Record<string, unknown> = { ...parsed.data, photo_path: photoPath };
  let removal = false;
  let note = "Saved.";

  if (row.status === "approved") {
    if (!parsed.data.permission_given) {
      // Permission withdrawn: take it down.
      Object.assign(update, { status: "pending", photo_public_path: null });
      removal = true;
      note = "Saved and unpublished: there's no permission on record.";
    } else if (photoChanged) {
      try {
        update.photo_public_path = await publishPhoto(db, { ...row, photo_path: photoPath });
      } catch (err) {
        await removeQuietly(db, BUCKETS.uploads, [newPhoto]);
        return { ok: false, message: `Couldn't publish the new photo: ${(err as Error).message}` };
      }
      removal = true; // old public photo is deleted below
      note = "Saved. The public page updates shortly.";
    } else {
      note = "Saved. The public page updates shortly.";
    }
  }

  const { error } = await db.from("testimonials").update(update).eq("id", row.id);
  if (error) {
    await removeQuietly(db, BUCKETS.uploads, [newPhoto]);
    if (update.photo_public_path) await removeQuietly(db, BUCKETS.public, [update.photo_public_path as string]);
    return { ok: false, message: `Couldn't save: ${error.message}` };
  }
  if (photoChanged) await removeQuietly(db, BUCKETS.uploads, [row.photo_path]);
  if ("photo_public_path" in update && row.photo_public_path !== update.photo_public_path) {
    await removeQuietly(db, BUCKETS.public, [row.photo_public_path]);
  }

  await audit(db, admin.id, "proof_testimonial_edit", { details: { id: row.id } });
  refreshProof(removal, row.id);
  return { ok: true, message: note };
}

export async function approveTestimonial(formData: FormData): Promise<void> {
  const { admin, db } = await adminContext();
  const row = await loadTestimonial(db, formData.get("id"));
  if (!row) return;
  const rule = canApproveTestimonial(row);
  if (!rule.ok) throw new Error(rule.reason);

  const publicPath = await publishPhoto(db, row);
  const { error } = await db
    .from("testimonials")
    .update({ status: "approved", photo_public_path: publicPath, reviewed_by: admin.id, reviewed_at: new Date().toISOString() })
    .eq("id", row.id);
  if (error) {
    await removeQuietly(db, BUCKETS.public, [publicPath]);
    throw new Error(error.message);
  }
  if (row.photo_public_path && row.photo_public_path !== publicPath) await removeQuietly(db, BUCKETS.public, [row.photo_public_path]);
  await audit(db, admin.id, "proof_testimonial_approve", { details: { id: row.id } });
  refreshProof(false, row.id);
}

async function takeDown(db: Db, row: TestimonialRow, status: "pending" | "rejected", adminId: string) {
  const { error } = await db
    .from("testimonials")
    .update({ status, photo_public_path: null, reviewed_by: adminId, reviewed_at: new Date().toISOString() })
    .eq("id", row.id);
  if (error) throw new Error(error.message);
  await removeQuietly(db, BUCKETS.public, [row.photo_public_path]);
}

export async function rejectTestimonial(formData: FormData): Promise<void> {
  const { admin, db } = await adminContext();
  const row = await loadTestimonial(db, formData.get("id"));
  if (!row) return;
  await takeDown(db, row, "rejected", admin.id);
  await audit(db, admin.id, "proof_testimonial_reject", { details: { id: row.id } });
  refreshProof(true, row.id);
}

export async function unpublishTestimonial(formData: FormData): Promise<void> {
  const { admin, db } = await adminContext();
  const row = await loadTestimonial(db, formData.get("id"));
  if (!row) return;
  await takeDown(db, row, "pending", admin.id);
  await audit(db, admin.id, "proof_testimonial_unpublish", { details: { id: row.id } });
  refreshProof(true, row.id);
}

export async function deleteTestimonial(formData: FormData): Promise<void> {
  const { admin, db } = await adminContext();
  const row = await loadTestimonial(db, formData.get("id"));
  if (!row) return;
  const { error } = await db.from("testimonials").delete().eq("id", row.id);
  if (error) throw new Error(error.message);
  await removeQuietly(db, BUCKETS.public, [row.photo_public_path]);
  await removeQuietly(db, BUCKETS.uploads, [row.photo_path]);
  await audit(db, admin.id, "proof_testimonial_delete", { details: { id: row.id } });
  refreshProof(true);
  redirect("/admin/proof/testimonials");
}

const DIRECTIONS = ["up", "down", "top", "bottom"] as const;

export async function moveTestimonial(formData: FormData): Promise<void> {
  const { db } = await adminContext();
  const row = await loadTestimonial(db, formData.get("id"));
  const dir = String(formData.get("direction")) as MoveDirection;
  if (!row || !(DIRECTIONS as readonly string[]).includes(dir)) return;
  const { data } = await db
    .from("testimonials")
    .select("id, sort_order")
    .eq("status", row.status)
    .order("sort_order", { ascending: true })
    .order("given_on", { ascending: false })
    .limit(1000);
  const rows = (data ?? []) as { id: string; sort_order: number }[];
  const updates = sortOrderUpdates(rows, moveId(rows.map((r) => r.id), row.id, dir));
  await Promise.all(updates.map((u) => db.from("testimonials").update({ sort_order: u.sort_order }).eq("id", u.id)));
  if (row.status === "approved") refreshProof(false);
  else revalidatePath("/admin/proof/testimonials");
}
