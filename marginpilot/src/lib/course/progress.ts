/** Pure helpers for course progress, the outline order and prev/next navigation. */

export type OutlineLesson = {
  id: string;
  module_id: string;
  slug: string;
  title: string;
  position: number;
  duration_seconds: number | null;
  is_preview: boolean;
};

export type OutlineModule = { id: string; title: string; summary: string | null; position: number };

export type ProgressRow = {
  lesson_id: string;
  completed_at: string | null;
  last_position_seconds: number;
  updated_at: string;
};

/** All lessons in course order: module position, then lesson position. */
export function flattenOutline<L extends OutlineLesson>(modules: readonly OutlineModule[], lessons: readonly L[]): L[] {
  const moduleOrder = new Map(
    [...modules].sort((a, b) => a.position - b.position).map((m, i) => [m.id, i] as const),
  );
  return lessons
    .filter((l) => moduleOrder.has(l.module_id))
    .sort(
      (a, b) =>
        moduleOrder.get(a.module_id)! - moduleOrder.get(b.module_id)! || a.position - b.position || a.id.localeCompare(b.id),
    );
}

export function courseCompletion(lessons: readonly { id: string }[], progress: readonly ProgressRow[]) {
  const ids = new Set(lessons.map((l) => l.id));
  const completed = progress.filter((p) => p.completed_at && ids.has(p.lesson_id)).length;
  const total = lessons.length;
  return { completed, total, percent: total ? Math.round((completed / total) * 100) : 0 };
}

/**
 * "Continue where you left off": the most recently touched lesson that isn't
 * complete; otherwise the first incomplete lesson in order; null when all are done
 * or there are no lessons.
 */
export function pickContinueLesson<L extends { id: string }>(
  ordered: readonly L[],
  progress: readonly ProgressRow[],
): { lesson: L; resumeAt: number } | null {
  const byId = new Map(progress.map((p) => [p.lesson_id, p]));
  const inCourse = new Set(ordered.map((l) => l.id));
  const recent = [...progress]
    .filter((p) => !p.completed_at && inCourse.has(p.lesson_id))
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
  if (recent) {
    const lesson = ordered.find((l) => l.id === recent.lesson_id)!;
    return { lesson, resumeAt: recent.last_position_seconds };
  }
  const first = ordered.find((l) => !byId.get(l.id)?.completed_at);
  return first ? { lesson: first, resumeAt: 0 } : null;
}

export function neighbours<L extends { id: string }>(ordered: readonly L[], id: string): { prev: L | null; next: L | null } {
  const i = ordered.findIndex((l) => l.id === id);
  if (i === -1) return { prev: null, next: null };
  return { prev: ordered[i - 1] ?? null, next: ordered[i + 1] ?? null };
}

/** Clamp a client-reported playback position before saving it. */
export function sanitizePosition(value: unknown, durationSeconds: number | null): number | null {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  const max = durationSeconds && durationSeconds > 0 ? durationSeconds + 60 : 24 * 3600;
  return Math.min(Math.floor(n), max);
}
