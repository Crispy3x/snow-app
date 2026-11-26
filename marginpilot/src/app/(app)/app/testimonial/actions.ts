"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath, revalidateTag } from "next/cache";
import { z } from "zod";
import type { ActionState } from "@/components/ui/form";
import { requireUser } from "@/lib/auth";
import { PROOF_CACHE_TAG } from "@/lib/proof";
import { renderAvatar } from "@/lib/proof-admin/render";
import { MAX_PHOTO_BYTES, customerTestimonialSchema, fieldErrors } from "@/lib/proof-admin/rules";
import { BUCKETS, removeQuietly } from "@/lib/proof-admin/storage";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const MAX_PENDING = 3;

/**
 * Customer testimonial submission. Inserted with the user's own client, so RLS
 * enforces source 'customer', status 'pending' and submitted_by = the user.
 * Nothing is public until an admin approves it.
 */
export async function submitTestimonial(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser("/app/testimonial");
  const parsed = customerTestimonialSchema().safeParse({
    name: formData.get("name") ?? "",
    quote: formData.get("quote") ?? "",
    store_type: formData.get("store_type") ?? "",
    given_on: formData.get("given_on") ?? "",
    permission_given: formData.get("permission_given") === "on",
  });
  if (!parsed.success) return { ok: false, message: "Check the form.", fieldErrors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const { count } = await supabase
    .from("testimonials")
    .select("id", { count: "exact", head: true })
    .eq("submitted_by", user.id)
    .eq("status", "pending");
  if ((count ?? 0) >= MAX_PENDING) {
    return { ok: false, message: `You have ${count} submissions waiting for review. Please wait until they've been reviewed.` };
  }

  let photoPath: string | null = null;
  const file = formData.get("photo");
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_PHOTO_BYTES) return { ok: false, message: "The photo is too large.", fieldErrors: { photo: "Choose a smaller photo." } };
    let jpeg: Buffer;
    try {
      jpeg = await renderAvatar(Buffer.from(await file.arrayBuffer()));
    } catch {
      return { ok: false, message: "The photo couldn't be read.", fieldErrors: { photo: "Use a JPEG, PNG or WebP photo." } };
    }
    photoPath = `${user.id}/${randomUUID()}.jpg`;
    const { error } = await supabase.storage.from(BUCKETS.uploads).upload(photoPath, jpeg, { contentType: "image/jpeg", upsert: false });
    if (error) return { ok: false, message: `The photo couldn't be uploaded: ${error.message}` };
  }

  const { error } = await supabase.from("testimonials").insert({
    ...parsed.data,
    photo_path: photoPath,
    source: "customer",
    status: "pending",
    submitted_by: user.id,
  });
  if (error) {
    // Customers can't delete storage objects; clean up the orphan photo server-side.
    if (photoPath) await removeQuietly(createAdminClient(), BUCKETS.uploads, [photoPath]);
    return { ok: false, message: `Couldn't send it: ${error.message}` };
  }

  revalidatePath("/app/testimonial");
  revalidatePath("/admin/proof/testimonials");
  return { ok: true, message: "Thank you. We'll review it before anything is shown, and you can withdraw it here at any time." };
}

/** Withdraw (delete) your own submission, including a published one. */
export async function withdrawTestimonial(formData: FormData): Promise<void> {
  const user = await requireUser("/app/testimonial");
  const id = z.string().uuid().safeParse(formData.get("id"));
  if (!id.success) return;
  const db = createAdminClient();
  const { data } = await db
    .from("testimonials")
    .select("id, status, photo_path, photo_public_path")
    .eq("id", id.data)
    .eq("submitted_by", user.id)
    .eq("source", "customer")
    .maybeSingle();
  if (!data) return;
  const { error } = await db.from("testimonials").delete().eq("id", data.id).eq("submitted_by", user.id);
  if (error) throw new Error(error.message);
  await removeQuietly(db, BUCKETS.public, [data.photo_public_path as string | null]);
  await removeQuietly(db, BUCKETS.uploads, [data.photo_path as string | null]);
  if (data.status === "approved") revalidateTag(PROOF_CACHE_TAG, { expire: 0 });
  revalidatePath("/app/testimonial");
  revalidatePath("/admin/proof/testimonials");
}
