import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { COURSE_BUCKET } from "./data";
import type { PositionUpdate } from "./ordering";

/** Service-role helpers for /admin/course. Call only after requireAdmin(). */

export type AdminTable = "course_modules" | "course_lessons" | "course_resources";

export async function applyPositions(db: SupabaseClient, table: AdminTable, updates: PositionUpdate[]): Promise<void> {
  // Few rows per list, so one update per changed row is fine.
  for (const u of updates) {
    const { error } = await db.from(table).update({ position: u.position }).eq("id", u.id);
    if (error) throw new Error(`Could not save the new order: ${error.message}`);
  }
}

/** Every storage object a lesson owns: resources, plus its uploaded video and captions. */
export async function lessonStoragePaths(db: SupabaseClient, lessonIds: string[]): Promise<string[]> {
  if (lessonIds.length === 0) return [];
  const [resources, lessons] = await Promise.all([
    db.from("course_resources").select("storage_path").in("lesson_id", lessonIds),
    db.from("course_lessons").select("video_provider, video_ref, captions_path").in("id", lessonIds),
  ]);
  const paths = new Set<string>();
  for (const r of resources.data ?? []) paths.add(r.storage_path as string);
  for (const l of lessons.data ?? []) {
    if (l.video_provider === "storage" && l.video_ref) paths.add(l.video_ref as string);
    if (l.captions_path) paths.add(l.captions_path as string);
  }
  return [...paths];
}

export async function removeStorageObjects(db: SupabaseClient, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  // Best effort: a missing object shouldn't block deleting the row.
  await db.storage.from(COURSE_BUCKET).remove(paths);
}
