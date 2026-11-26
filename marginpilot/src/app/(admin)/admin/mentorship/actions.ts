"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { adminContext, audit, userEmails } from "@/lib/admin/server";
import type { ActionState } from "@/components/ui/form";
import { moveItem } from "@/lib/course/ordering";
import { weekLabel } from "@/lib/mentorship/iso-week";
import { MENTORSHIP_BUCKET, sendAuditDeliveredEmail } from "@/lib/mentorship/server";
import { feedbackSchema, fieldErrorsFrom, resourceLinkSchema, sessionSchema, SESSION_STATUSES } from "@/lib/mentorship/validation";

/** Admin mentorship management. Every action re-checks the admin and uses the service role. */

function refresh() {
  revalidatePath("/admin/mentorship", "layout");
  revalidatePath("/app/mentorship");
}

const str = (v: FormDataEntryValue | null) => (typeof v === "string" ? v : "");

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export async function saveSession(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { admin, db } = await adminContext();
  const idRaw = str(formData.get("id"));
  const id = idRaw ? z.uuid().safeParse(idRaw) : null;
  if (id && !id.success) return { ok: false, message: "Session not found." };
  const parsed = sessionSchema.safeParse({
    title: str(formData.get("title")),
    description: str(formData.get("description")),
    starts_local: str(formData.get("starts_local")),
    tz_offset: str(formData.get("tz_offset")),
    duration_min: str(formData.get("duration_min")),
    join_url: str(formData.get("join_url")),
    recording_url: str(formData.get("recording_url")),
    status: str(formData.get("status")) || "scheduled",
  });
  if (!parsed.success) return { ok: false, message: "Check the highlighted fields.", fieldErrors: fieldErrorsFrom(parsed.error) };
  const now = new Date().toISOString();
  if (id?.success) {
    const { error } = await db.from("mentorship_sessions").update({ ...parsed.data, updated_at: now }).eq("id", id.data);
    if (error) return { ok: false, message: `Couldn't save the session: ${error.message}` };
    await audit(db, admin.id, "mentorship.session.update", { details: { id: id.data, status: parsed.data.status } });
    refresh();
    return { ok: true, message: "Session saved." };
  }
  const { error } = await db.from("mentorship_sessions").insert({ ...parsed.data, created_by: admin.id, updated_at: now });
  if (error) return { ok: false, message: `Couldn't create the session: ${error.message}` };
  await audit(db, admin.id, "mentorship.session.create", { details: { title: parsed.data.title, starts_at: parsed.data.starts_at } });
  refresh();
  return { ok: true, message: "Session scheduled. Mentorship members can see it now." };
}

export async function setSessionStatus(formData: FormData) {
  const { admin, db } = await adminContext();
  const id = z.uuid().safeParse(formData.get("id"));
  const status = z.enum(SESSION_STATUSES).safeParse(formData.get("status"));
  if (!id.success || !status.success) return;
  await db.from("mentorship_sessions").update({ status: status.data, updated_at: new Date().toISOString() }).eq("id", id.data);
  await audit(db, admin.id, `mentorship.session.${status.data}`, { details: { id: id.data } });
  refresh();
}

export async function deleteSession(formData: FormData) {
  const { admin, db } = await adminContext();
  const id = z.uuid().safeParse(formData.get("id"));
  if (!id.success) return;
  await db.from("mentorship_sessions").delete().eq("id", id.data);
  await audit(db, admin.id, "mentorship.session.delete", { details: { id: id.data } });
  refresh();
  redirect("/admin/mentorship?deleted=session");
}

// ---------------------------------------------------------------------------
// Resources
// ---------------------------------------------------------------------------

async function nextResourceOrder(db: Awaited<ReturnType<typeof adminContext>>["db"]) {
  const { data } = await db.from("mentorship_resources").select("sort_order").order("sort_order", { ascending: false }).limit(1).maybeSingle();
  return (data?.sort_order ?? 0) + 1;
}

export async function addResourceLink(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { admin, db } = await adminContext();
  const parsed = resourceLinkSchema.safeParse({
    title: str(formData.get("title")),
    description: str(formData.get("description")),
    url: str(formData.get("url")),
  });
  if (!parsed.success) return { ok: false, message: "Check the highlighted fields.", fieldErrors: fieldErrorsFrom(parsed.error) };
  const { error } = await db.from("mentorship_resources").insert({ ...parsed.data, sort_order: await nextResourceOrder(db) });
  if (error) return { ok: false, message: `Couldn't add the resource: ${error.message}` };
  await audit(db, admin.id, "mentorship.resource.create", { details: { title: parsed.data.title } });
  refresh();
  return { ok: true, message: "Resource added." };
}

const MAX_UPLOAD = 50 * 1024 * 1024;

export type UploadTicket = { ok: true; path: string; signedUrl: string } | { ok: false; message: string };

export async function createResourceUploadUrl(input: { fileName: string; size: number }): Promise<UploadTicket> {
  const { db } = await adminContext();
  const parsed = z.object({ fileName: z.string().min(1).max(200), size: z.number().int().positive() }).safeParse(input);
  if (!parsed.success) return { ok: false, message: "Choose a file to upload." };
  if (parsed.data.size > MAX_UPLOAD) return { ok: false, message: "That file is too large (max 50 MB). Link to it instead." };
  const safe = parsed.data.fileName.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120) || "file";
  const path = `resources/${crypto.randomUUID()}/${safe}`;
  const { data, error } = await db.storage.from(MENTORSHIP_BUCKET).createSignedUploadUrl(path);
  if (error || !data) return { ok: false, message: "Storage isn't available right now. Try again." };
  return { ok: true, path, signedUrl: data.signedUrl };
}

export async function finishResourceUpload(input: { path: string; title: string; description: string; fileName: string }): Promise<ActionState> {
  const { admin, db } = await adminContext();
  const parsed = z
    .object({
      path: z.string().regex(/^resources\/[0-9a-f-]{36}\/[\w.-]+$/),
      title: z.string().trim().max(200),
      description: z.string().trim().max(2000),
      fileName: z.string().max(255),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, message: "The upload details were not valid." };
  const v = parsed.data;
  const title = v.title.length >= 2 ? v.title : v.fileName;
  const { error } = await db.from("mentorship_resources").insert({
    title,
    description: v.description || null,
    storage_path: v.path,
    file_name: v.fileName,
    sort_order: await nextResourceOrder(db),
  });
  if (error) {
    await db.storage.from(MENTORSHIP_BUCKET).remove([v.path]);
    return { ok: false, message: `Couldn't save the resource: ${error.message}` };
  }
  await audit(db, admin.id, "mentorship.resource.upload", { details: { title, path: v.path } });
  refresh();
  return { ok: true, message: `Uploaded “${title}”.` };
}

export async function moveResource(formData: FormData) {
  const { db } = await adminContext();
  const id = z.uuid().safeParse(formData.get("id"));
  const dir = z.enum(["up", "down"]).safeParse(formData.get("direction"));
  if (!id.success || !dir.success) return;
  const { data } = await db.from("mentorship_resources").select("id, sort_order, created_at").order("sort_order").order("created_at");
  const items = ((data ?? []) as { id: string }[]).map((r, i) => ({ id: r.id, position: i + 1 }));
  for (const u of moveItem(items, id.data, dir.data)) await db.from("mentorship_resources").update({ sort_order: u.position }).eq("id", u.id);
  refresh();
}

export async function deleteResource(formData: FormData) {
  const { admin, db } = await adminContext();
  const id = z.uuid().safeParse(formData.get("id"));
  if (!id.success) return;
  const { data } = await db.from("mentorship_resources").select("title, storage_path").eq("id", id.data).maybeSingle();
  if (!data) return;
  await db.from("mentorship_resources").delete().eq("id", id.data);
  if (data.storage_path) await db.storage.from(MENTORSHIP_BUCKET).remove([data.storage_path as string]);
  await audit(db, admin.id, "mentorship.resource.delete", { details: { id: id.data, title: data.title } });
  refresh();
}

// ---------------------------------------------------------------------------
// Audit requests
// ---------------------------------------------------------------------------

export async function startReview(formData: FormData) {
  const { admin, db } = await adminContext();
  const id = z.uuid().safeParse(formData.get("id"));
  if (!id.success) return;
  const { data } = await db.from("store_audit_requests").select("org_id, status").eq("id", id.data).maybeSingle();
  if (!data || data.status !== "requested") return;
  await db.from("store_audit_requests").update({ status: "in_review", updated_at: new Date().toISOString() }).eq("id", id.data);
  await audit(db, admin.id, "mentorship.audit.in_review", { orgId: data.org_id as string, details: { id: id.data } });
  refresh();
}

export async function saveFeedback(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { admin, db } = await adminContext();
  const parsed = feedbackSchema.safeParse({
    id: str(formData.get("id")),
    feedback: str(formData.get("feedback")),
    intent: str(formData.get("intent")),
  });
  if (!parsed.success) return { ok: false, message: "Check the highlighted fields.", fieldErrors: fieldErrorsFrom(parsed.error) };
  const v = parsed.data;
  const { data: req } = await db
    .from("store_audit_requests")
    .select("id, org_id, week_of, status, organizations(name, owner_id)")
    .eq("id", v.id)
    .maybeSingle();
  if (!req) return { ok: false, message: "Request not found." };
  const now = new Date().toISOString();
  const wasDelivered = req.status === "delivered";

  // Drafts live in feedback_draft, which members can't select. Delivering copies it to feedback.
  const update =
    v.intent === "deliver"
      ? { feedback: v.feedback, feedback_draft: null, status: "delivered", delivered_at: wasDelivered ? undefined : now, delivered_by: admin.id, updated_at: now }
      : { feedback_draft: v.feedback || null, status: wasDelivered ? "delivered" : "in_review", updated_at: now };
  const { error } = await db.from("store_audit_requests").update(update).eq("id", v.id);
  if (error) return { ok: false, message: `Couldn't save: ${error.message}` };
  await audit(db, admin.id, v.intent === "deliver" ? "mentorship.audit.deliver" : "mentorship.audit.save", {
    orgId: req.org_id as string,
    details: { id: v.id, week_of: req.week_of },
  });
  refresh();

  if (v.intent !== "deliver") return { ok: true, message: wasDelivered ? "Draft saved. The workspace still sees the delivered version until you deliver again." : "Draft saved. The workspace can't see it until you deliver it." };
  if (wasDelivered) return { ok: true, message: "Updated the delivered feedback." };

  const org = req.organizations as unknown as { name: string; owner_id: string } | null;
  let emailed = false;
  if (org?.owner_id) {
    const emails = await userEmails(db, [org.owner_id]);
    const to = emails.get(org.owner_id);
    if (to) emailed = await sendAuditDeliveredEmail({ to, orgName: org.name, weekLabel: weekLabel(req.week_of as string) });
  }
  return {
    ok: true,
    message: emailed ? "Delivered. The workspace owner was emailed." : "Delivered. The workspace sees it on their Mentorship page (no email sent: RESEND_API_KEY isn't set or sending failed).",
  };
}
