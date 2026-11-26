import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { flattenOutline, type OutlineLesson, type OutlineModule, type ProgressRow } from "./progress";

/**
 * Course reads for signed-in pages. The outline (titles, durations, preview flags)
 * is read with the service role so people without access still see what the course
 * covers; lesson bodies, video references and resources are only returned by the
 * functions below after the caller has checked entitlement with canViewLesson().
 */

export const COURSE_BUCKET = "course-resources";
export const RESOURCE_URL_TTL_SECONDS = 10 * 60;
const VIDEO_URL_MIN_TTL_SECONDS = 2 * 3600;

export type CourseOutline = {
  modules: OutlineModule[];
  lessons: OutlineLesson[]; // published only, in course order
};

export async function getCourseOutline(): Promise<CourseOutline> {
  const db = createAdminClient();
  const [modules, lessons] = await Promise.all([
    db.from("course_modules").select("id, title, summary, position").order("position"),
    db
      .from("course_lessons")
      .select("id, module_id, slug, title, position, duration_seconds, is_preview")
      .eq("is_published", true)
      .order("position"),
  ]);
  if (modules.error) throw new Error(`Could not load course modules: ${modules.error.message}`);
  if (lessons.error) throw new Error(`Could not load course lessons: ${lessons.error.message}`);
  const mods = (modules.data ?? []) as OutlineModule[];
  return { modules: mods, lessons: flattenOutline(mods, (lessons.data ?? []) as OutlineLesson[]) };
}

/** The signed-in user's own progress rows (RLS: own rows only). */
export async function getMyProgress(): Promise<ProgressRow[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("lesson_progress").select("lesson_id, completed_at, last_position_seconds, updated_at");
  return (data ?? []) as ProgressRow[];
}

export type LessonDetail = {
  id: string;
  module_id: string;
  slug: string;
  title: string;
  summary: string | null;
  body: string | null;
  video_provider: string | null;
  video_ref: string | null;
  duration_seconds: number | null;
  is_preview: boolean;
  is_published: boolean;
  captions_path: string | null;
  captions_label: string | null;
};

/** Full lesson row by slug (service role). Callers must check canViewLesson() before rendering body/video. */
export async function getLessonBySlug(slug: string): Promise<LessonDetail | null> {
  const db = createAdminClient();
  const { data } = await db
    .from("course_lessons")
    .select(
      "id, module_id, slug, title, summary, body, video_provider, video_ref, duration_seconds, is_preview, is_published, captions_path, captions_label",
    )
    .eq("slug", slug)
    .maybeSingle();
  return (data as LessonDetail | null) ?? null;
}

export type ResourceLink = {
  id: string;
  title: string;
  kind: string;
  file_name: string | null;
  size_bytes: number | null;
  url: string | null;
};

/** Resources for an entitled viewer, each with a 10-minute signed download URL. */
export async function getResourceLinks(lessonId: string): Promise<ResourceLink[]> {
  const db = createAdminClient();
  const { data } = await db
    .from("course_resources")
    .select("id, title, storage_path, position, kind, file_name, size_bytes")
    .eq("lesson_id", lessonId)
    .order("position");
  const rows = (data ?? []) as {
    id: string;
    title: string;
    storage_path: string;
    kind: string | null;
    file_name: string | null;
    size_bytes: number | null;
  }[];
  if (rows.length === 0) return [];
  const { data: signed } = await db.storage
    .from(COURSE_BUCKET)
    .createSignedUrls(
      rows.map((r) => r.storage_path),
      RESOURCE_URL_TTL_SECONDS,
      { download: true },
    );
  const urlByPath = new Map((signed ?? []).map((s) => [s.path, s.error ? null : s.signedUrl]));
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    kind: r.kind ?? "file",
    file_name: r.file_name,
    size_bytes: r.size_bytes,
    url: urlByPath.get(r.storage_path) ?? null,
  }));
}

/** Signed URL for a storage-hosted lesson video or captions file. Long enough to watch the lesson. */
export async function signedMediaUrl(path: string, durationSeconds: number | null): Promise<string | null> {
  const db = createAdminClient();
  const ttl = Math.max(VIDEO_URL_MIN_TTL_SECONDS, (durationSeconds ?? 0) * 3);
  const { data, error } = await db.storage.from(COURSE_BUCKET).createSignedUrl(path, ttl);
  return error ? null : data.signedUrl;
}
