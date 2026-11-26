"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ActionState } from "@/components/ui/form";
import { applyPositions, lessonStoragePaths, removeStorageObjects } from "@/lib/course/admin";
import { COURSE_BUCKET } from "@/lib/course/data";
import { moveItem, moveToList, nextPosition, removeAndRenumber, type Positioned } from "@/lib/course/ordering";
import { UPLOAD_FOLDERS, uploadPath } from "@/lib/course/paths";
import { isValidSlug, slugify, uniqueSlug } from "@/lib/course/slug";
import { VIDEO_PROVIDERS, parseDurationInput, parseVideoRef } from "@/lib/course/video";

/** Admin course management. Every action re-checks requireAdmin() and then uses the service role. */

function refresh() {
  revalidatePath("/admin/course", "layout");
  revalidatePath("/app/course", "layout");
}

function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    out[key] ??= issue.message;
  }
  return out;
}

const id = z.uuid();
const direction = z.enum(["up", "down"]);
const str = (v: FormDataEntryValue | null) => (typeof v === "string" ? v : "");

async function siblings(table: "course_modules" | "course_lessons" | "course_resources", column?: string, value?: string) {
  const db = createAdminClient();
  let q = db.from(table).select("id, position");
  if (column && value) q = q.eq(column, value);
  const { data } = await q;
  return (data ?? []) as Positioned[];
}

// ---------------------------------------------------------------------------
// Modules
// ---------------------------------------------------------------------------

const moduleSchema = z.object({
  id: id.optional(),
  title: z.string().trim().min(1, "Enter a module title.").max(200, "Keep the title under 200 characters."),
  summary: z.string().trim().max(2000, "Keep the summary under 2,000 characters."),
});

export async function saveModule(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin();
  const parsed = moduleSchema.safeParse({
    id: str(formData.get("id")) || undefined,
    title: str(formData.get("title")),
    summary: str(formData.get("summary")),
  });
  if (!parsed.success) return { ok: false, message: "Check the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };

  const db = createAdminClient();
  const values = { title: parsed.data.title, summary: parsed.data.summary || null };
  if (parsed.data.id) {
    const { error } = await db.from("course_modules").update(values).eq("id", parsed.data.id);
    if (error) return { ok: false, message: `Could not save the module: ${error.message}` };
  } else {
    const position = nextPosition(await siblings("course_modules"));
    const { error } = await db.from("course_modules").insert({ ...values, position });
    if (error) return { ok: false, message: `Could not create the module: ${error.message}` };
  }
  refresh();
  return { ok: true, message: parsed.data.id ? "Module saved." : "Module added at the end of the course." };
}

export async function moveModule(formData: FormData) {
  await requireAdmin();
  const moduleId = id.safeParse(formData.get("id"));
  const dir = direction.safeParse(formData.get("direction"));
  if (!moduleId.success || !dir.success) return;
  await applyPositions(createAdminClient(), "course_modules", moveItem(await siblings("course_modules"), moduleId.data, dir.data));
  refresh();
}

export async function deleteModule(formData: FormData) {
  await requireAdmin();
  const moduleId = id.safeParse(formData.get("id"));
  if (!moduleId.success) return;
  const db = createAdminClient();
  const { data: lessons } = await db.from("course_lessons").select("id").eq("module_id", moduleId.data);
  const paths = await lessonStoragePaths(db, (lessons ?? []).map((l) => l.id as string));
  const all = await siblings("course_modules");
  const { error } = await db.from("course_modules").delete().eq("id", moduleId.data); // cascades to lessons/resources/progress
  if (error) throw new Error(`Could not delete the module: ${error.message}`);
  await removeStorageObjects(db, paths);
  await applyPositions(db, "course_modules", removeAndRenumber(all, moduleId.data));
  refresh();
}

// ---------------------------------------------------------------------------
// Lessons
// ---------------------------------------------------------------------------

const lessonSchema = z
  .object({
    id: id.optional(),
    moduleId: id,
    title: z.string().trim().min(1, "Enter a lesson title.").max(200, "Keep the title under 200 characters."),
    slug: z.string().trim().max(80, "Keep the slug under 80 characters."),
    summary: z.string().trim().max(1000, "Keep the summary under 1,000 characters."),
    body: z.string().max(50000, "The lesson text is too long (50,000 characters max)."),
    provider: z.enum(["", ...VIDEO_PROVIDERS]),
    videoRef: z.string().trim().max(500),
    duration: z.string().trim().max(12),
    captionsLabel: z.string().trim().max(60),
    isPreview: z.boolean(),
    isPublished: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (v.slug && !isValidSlug(v.slug)) {
      ctx.addIssue({ code: "custom", path: ["slug"], message: "Use lowercase letters, numbers and single hyphens (and not a reserved word)." });
    }
    if (v.provider && !parseVideoRef(v.provider, v.videoRef)) {
      const hint: Record<string, string> = {
        youtube: "Paste a YouTube link or the 11-character video ID.",
        vimeo: "Paste a Vimeo link or the numeric video ID.",
        mux: "Paste the Mux playback ID.",
        storage: "Upload a video file below, or enter its path in the course-resources bucket.",
      };
      ctx.addIssue({ code: "custom", path: ["videoRef"], message: hint[v.provider] });
    }
    const d = parseDurationInput(v.duration);
    if (d !== null && (!Number.isFinite(d) || d > 24 * 3600)) {
      ctx.addIssue({ code: "custom", path: ["duration"], message: "Enter a duration like 12:30 or 1:02:00." });
    }
    if (v.isPublished && !v.provider && !v.body.trim()) {
      ctx.addIssue({ code: "custom", path: ["isPublished"], message: "Add a video or lesson text before publishing." });
    }
  });

export async function saveLesson(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin();
  const parsed = lessonSchema.safeParse({
    id: str(formData.get("id")) || undefined,
    moduleId: str(formData.get("moduleId")),
    title: str(formData.get("title")),
    slug: str(formData.get("slug")).toLowerCase(),
    summary: str(formData.get("summary")),
    body: str(formData.get("body")),
    provider: str(formData.get("provider")),
    videoRef: str(formData.get("videoRef")),
    duration: str(formData.get("duration")),
    captionsLabel: str(formData.get("captionsLabel")),
    isPreview: formData.get("isPreview") === "on",
    isPublished: formData.get("isPublished") === "on",
  });
  if (!parsed.success) return { ok: false, message: "Check the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
  const v = parsed.data;
  const db = createAdminClient();

  const { data: mod } = await db.from("course_modules").select("id").eq("id", v.moduleId).maybeSingle();
  if (!mod) return { ok: false, message: "Choose a module.", fieldErrors: { moduleId: "Choose a module." } };

  // Slug: the one typed in, or generated from the title; unique across lessons.
  const { data: others } = await db.from("course_lessons").select("id, slug");
  const taken = (others ?? []).filter((o) => o.id !== v.id).map((o) => o.slug as string);
  let slug: string;
  if (v.slug) {
    if (taken.includes(v.slug)) {
      return { ok: false, message: "Check the highlighted fields.", fieldErrors: { slug: "Another lesson already uses this slug." } };
    }
    slug = v.slug;
  } else {
    slug = uniqueSlug(slugify(v.title), taken);
  }

  const video = v.provider ? parseVideoRef(v.provider, v.videoRef) : null;
  const values = {
    title: v.title,
    slug,
    summary: v.summary || null,
    body: v.body.trim() ? v.body : null,
    video_provider: video ? v.provider : null,
    // store the normalised reference (e.g. the ID extracted from a pasted URL)
    video_ref: !video
      ? null
      : video.provider === "youtube"
        ? video.id
        : video.provider === "vimeo"
          ? video.hash
            ? `${video.id}/${video.hash}`
            : video.id
          : video.provider === "mux"
            ? video.playbackId
            : video.path,
    duration_seconds: parseDurationInput(v.duration),
    captions_label: v.captionsLabel || null,
    is_preview: v.isPreview,
    is_published: v.isPublished,
    updated_at: new Date().toISOString(),
  };

  if (!v.id) {
    const position = nextPosition(await siblings("course_lessons", "module_id", v.moduleId));
    const { data, error } = await db
      .from("course_lessons")
      .insert({ ...values, module_id: v.moduleId, position })
      .select("id")
      .single();
    if (error) return { ok: false, message: `Could not create the lesson: ${error.message}` };
    refresh();
    redirect(`/admin/course/lessons/${data.id}?created=1`);
  }

  const { data: current } = await db.from("course_lessons").select("id, module_id").eq("id", v.id).maybeSingle();
  if (!current) return { ok: false, message: "This lesson no longer exists." };

  const { error } = await db.from("course_lessons").update(values).eq("id", v.id);
  if (error) return { ok: false, message: `Could not save the lesson: ${error.message}` };
  if (current.module_id !== v.moduleId) await relocateLesson(v.id, current.module_id as string, v.moduleId);
  refresh();
  return { ok: true, message: v.isPublished ? "Lesson saved and published." : "Lesson saved as a draft (not published)." };
}

async function relocateLesson(lessonId: string, fromModule: string, toModule: string) {
  const db = createAdminClient();
  const [source, target] = await Promise.all([
    siblings("course_lessons", "module_id", fromModule),
    siblings("course_lessons", "module_id", toModule),
  ]);
  // After an update the lesson may already be listed in the target; moveToList handles both.
  const plan = moveToList(
    source.some((s) => s.id === lessonId) ? source : [...source, { id: lessonId, position: Number.MAX_SAFE_INTEGER }],
    target,
    lessonId,
  );
  const { error } = await db.from("course_lessons").update({ module_id: toModule, position: plan.moved.position }).eq("id", lessonId);
  if (error) throw new Error(`Could not move the lesson: ${error.message}`);
  await applyPositions(db, "course_lessons", plan.source);
}

export async function moveLesson(formData: FormData) {
  await requireAdmin();
  const lessonId = id.safeParse(formData.get("id"));
  const dir = direction.safeParse(formData.get("direction"));
  if (!lessonId.success || !dir.success) return;
  const db = createAdminClient();
  const { data: lesson } = await db.from("course_lessons").select("module_id").eq("id", lessonId.data).maybeSingle();
  if (!lesson) return;
  const list = await siblings("course_lessons", "module_id", lesson.module_id as string);
  await applyPositions(db, "course_lessons", moveItem(list, lessonId.data, dir.data));
  refresh();
}

export async function moveLessonToModule(formData: FormData) {
  await requireAdmin();
  const lessonId = id.safeParse(formData.get("id"));
  const moduleId = id.safeParse(formData.get("moduleId"));
  if (!lessonId.success || !moduleId.success) return;
  const db = createAdminClient();
  const [{ data: lesson }, { data: mod }] = await Promise.all([
    db.from("course_lessons").select("module_id").eq("id", lessonId.data).maybeSingle(),
    db.from("course_modules").select("id").eq("id", moduleId.data).maybeSingle(),
  ]);
  if (!lesson || !mod || lesson.module_id === moduleId.data) return;
  await relocateLesson(lessonId.data, lesson.module_id as string, moduleId.data);
  refresh();
}

export async function setLessonPublished(formData: FormData) {
  await requireAdmin();
  const lessonId = id.safeParse(formData.get("id"));
  if (!lessonId.success) return;
  const publish = formData.get("publish") === "1";
  const db = createAdminClient();
  if (publish) {
    const { data } = await db.from("course_lessons").select("video_provider, body").eq("id", lessonId.data).maybeSingle();
    if (!data || (!data.video_provider && !String(data.body ?? "").trim())) return; // nothing to show yet
  }
  await db
    .from("course_lessons")
    .update({ is_published: publish, updated_at: new Date().toISOString() })
    .eq("id", lessonId.data);
  refresh();
}

export async function deleteLesson(formData: FormData) {
  await requireAdmin();
  const lessonId = id.safeParse(formData.get("id"));
  if (!lessonId.success) return;
  const db = createAdminClient();
  const { data: lesson } = await db.from("course_lessons").select("module_id").eq("id", lessonId.data).maybeSingle();
  if (lesson) {
    const paths = await lessonStoragePaths(db, [lessonId.data]);
    const list = await siblings("course_lessons", "module_id", lesson.module_id as string);
    const { error } = await db.from("course_lessons").delete().eq("id", lessonId.data);
    if (error) throw new Error(`Could not delete the lesson: ${error.message}`);
    await removeStorageObjects(db, paths);
    await applyPositions(db, "course_lessons", removeAndRenumber(list, lessonId.data));
  }
  refresh();
  if (formData.get("returnTo") === "list") redirect("/admin/course?deleted=lesson");
}

// ---------------------------------------------------------------------------
// Uploads (resources, lesson video, captions)
// Files go straight from the browser to storage with a one-time signed upload URL,
// so large videos don't pass through a server action (1 MB body limit).
// ---------------------------------------------------------------------------

const MAX_BYTES: Record<(typeof UPLOAD_FOLDERS)[number], number> = {
  resources: 100 * 1024 * 1024,
  video: 5 * 1024 * 1024 * 1024,
  captions: 2 * 1024 * 1024,
};

const uploadStartSchema = z.object({
  lessonId: id,
  folder: z.enum(UPLOAD_FOLDERS),
  fileName: z.string().min(1).max(255),
  size: z.number().int().positive(),
});

export type UploadTicket = { ok: true; path: string; signedUrl: string } | { ok: false; message: string };

export async function createUploadUrl(input: z.input<typeof uploadStartSchema>): Promise<UploadTicket> {
  await requireAdmin();
  const parsed = uploadStartSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Choose a file to upload." };
  const { lessonId, folder, fileName, size } = parsed.data;
  if (size > MAX_BYTES[folder]) {
    return { ok: false, message: `That file is too large (max ${Math.round(MAX_BYTES[folder] / 1024 / 1024)} MB).` };
  }
  if (folder === "captions" && !fileName.toLowerCase().endsWith(".vtt")) {
    return { ok: false, message: "Captions must be a WebVTT (.vtt) file." };
  }
  const db = createAdminClient();
  const { data: lesson } = await db.from("course_lessons").select("id").eq("id", lessonId).maybeSingle();
  if (!lesson) return { ok: false, message: "This lesson no longer exists." };
  const path = uploadPath(lessonId, folder, fileName);
  const { data, error } = await db.storage.from(COURSE_BUCKET).createSignedUploadUrl(path);
  if (error || !data) return { ok: false, message: "Storage isn't available right now. Try again." };
  return { ok: true, path, signedUrl: data.signedUrl };
}

const RESOURCE_KINDS = ["file", "pdf", "spreadsheet", "template", "checklist", "other"] as const;

const uploadDoneSchema = z.object({
  lessonId: id,
  folder: z.enum(UPLOAD_FOLDERS),
  path: z.string().min(1).max(500),
  title: z.string().trim().max(200),
  kind: z.enum(RESOURCE_KINDS).optional(),
  fileName: z.string().max(255),
  contentType: z.string().max(200),
  size: z.number().int().nonnegative(),
});

export async function finishUpload(input: z.input<typeof uploadDoneSchema>): Promise<ActionState> {
  await requireAdmin();
  const parsed = uploadDoneSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "The upload details were not valid." };
  const v = parsed.data;
  if (!v.path.startsWith(`${v.lessonId}/${v.folder}/`) || v.path.includes("..")) {
    return { ok: false, message: "The upload details were not valid." };
  }
  const db = createAdminClient();

  if (v.folder === "resources") {
    const position = nextPosition(await siblings("course_resources", "lesson_id", v.lessonId));
    const { error } = await db.from("course_resources").insert({
      lesson_id: v.lessonId,
      title: v.title || v.fileName,
      storage_path: v.path,
      position,
      kind: v.kind ?? "file",
      file_name: v.fileName,
      content_type: v.contentType || null,
      size_bytes: v.size,
    });
    if (error) {
      await removeStorageObjects(db, [v.path]);
      return { ok: false, message: `Could not save the resource: ${error.message}` };
    }
    refresh();
    return { ok: true, message: `Uploaded “${v.title || v.fileName}”.` };
  }

  const { data: lesson } = await db
    .from("course_lessons")
    .select("video_provider, video_ref, captions_path")
    .eq("id", v.lessonId)
    .maybeSingle();
  if (!lesson) return { ok: false, message: "This lesson no longer exists." };

  const update =
    v.folder === "video"
      ? { video_provider: "storage", video_ref: v.path, updated_at: new Date().toISOString() }
      : { captions_path: v.path, updated_at: new Date().toISOString() };
  const { error } = await db.from("course_lessons").update(update).eq("id", v.lessonId);
  if (error) return { ok: false, message: `Could not attach the file: ${error.message}` };

  // Replace: remove the previous file this lesson owned.
  const old = v.folder === "video" ? (lesson.video_provider === "storage" ? lesson.video_ref : null) : lesson.captions_path;
  if (old && old !== v.path) await removeStorageObjects(db, [old as string]);
  refresh();
  return { ok: true, message: v.folder === "video" ? "Video uploaded and attached to this lesson." : "Captions uploaded." };
}

export async function removeCaptions(formData: FormData) {
  await requireAdmin();
  const lessonId = id.safeParse(formData.get("id"));
  if (!lessonId.success) return;
  const db = createAdminClient();
  const { data } = await db.from("course_lessons").select("captions_path").eq("id", lessonId.data).maybeSingle();
  if (data?.captions_path) {
    await db.from("course_lessons").update({ captions_path: null, updated_at: new Date().toISOString() }).eq("id", lessonId.data);
    await removeStorageObjects(db, [data.captions_path as string]);
  }
  refresh();
}

// ---------------------------------------------------------------------------
// Resources
// ---------------------------------------------------------------------------

export async function renameResource(formData: FormData) {
  await requireAdmin();
  const resourceId = id.safeParse(formData.get("id"));
  const title = z.string().trim().min(1).max(200).safeParse(formData.get("title"));
  const kind = z.enum(RESOURCE_KINDS).safeParse(formData.get("kind"));
  if (!resourceId.success || !title.success) return;
  await createAdminClient()
    .from("course_resources")
    .update({ title: title.data, ...(kind.success ? { kind: kind.data } : {}) })
    .eq("id", resourceId.data);
  refresh();
}

export async function moveResource(formData: FormData) {
  await requireAdmin();
  const resourceId = id.safeParse(formData.get("id"));
  const dir = direction.safeParse(formData.get("direction"));
  if (!resourceId.success || !dir.success) return;
  const db = createAdminClient();
  const { data } = await db.from("course_resources").select("lesson_id").eq("id", resourceId.data).maybeSingle();
  if (!data) return;
  const list = await siblings("course_resources", "lesson_id", data.lesson_id as string);
  await applyPositions(db, "course_resources", moveItem(list, resourceId.data, dir.data));
  refresh();
}

export async function deleteResource(formData: FormData) {
  await requireAdmin();
  const resourceId = id.safeParse(formData.get("id"));
  if (!resourceId.success) return;
  const db = createAdminClient();
  const { data } = await db.from("course_resources").select("lesson_id, storage_path").eq("id", resourceId.data).maybeSingle();
  if (!data) return;
  const list = await siblings("course_resources", "lesson_id", data.lesson_id as string);
  await db.from("course_resources").delete().eq("id", resourceId.data);
  await removeStorageObjects(db, [data.storage_path as string]);
  await applyPositions(db, "course_resources", removeAndRenumber(list, resourceId.data));
  refresh();
}
