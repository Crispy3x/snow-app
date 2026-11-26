import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { Alert, EmptyState, PageHeader, Panel } from "@/components/ui/app";
import { LinkButton, buttonClasses } from "@/components/ui/button";
import { Badge } from "@/components/ui/layout";
import { SubmitButton } from "@/components/ui/submit-button";
import { ModuleForm } from "@/components/course/admin/module-form";
import { MoveButtons } from "@/components/course/admin/move-buttons";
import { ConfirmDelete } from "@/components/course/admin/confirm-delete";
import { sortByPosition } from "@/lib/course/ordering";
import { formatDuration } from "@/lib/course/video";
import {
  deleteModule,
  moveLesson,
  moveLessonToModule,
  moveModule,
  saveModule,
  setLessonPublished,
} from "./actions";

export const metadata = { title: "Course content" };

type ModuleRow = { id: string; title: string; summary: string | null; position: number };
type LessonRow = {
  id: string;
  module_id: string;
  title: string;
  slug: string;
  position: number;
  duration_seconds: number | null;
  is_preview: boolean;
  is_published: boolean;
  video_provider: string | null;
  course_resources: { count: number }[];
};

export default async function AdminCoursePage({ searchParams }: { searchParams: Promise<{ deleted?: string }> }) {
  await requireAdmin();
  const { deleted } = await searchParams;
  const db = createAdminClient();
  const [{ data: modulesData }, { data: lessonsData }] = await Promise.all([
    db.from("course_modules").select("id, title, summary, position").order("position"),
    db
      .from("course_lessons")
      .select("id, module_id, title, slug, position, duration_seconds, is_preview, is_published, video_provider, course_resources(count)")
      .order("position"),
  ]);
  const modules = sortByPosition((modulesData ?? []) as ModuleRow[]);
  const lessons = (lessonsData ?? []) as unknown as LessonRow[];
  const unpublished = lessons.filter((l) => !l.is_published).length;

  return (
    <>
      <PageHeader
        title="Course content"
        description="Modules and lessons in the order customers see them. Lessons stay hidden until they are published."
      />

      <div className="space-y-6">
        {deleted === "lesson" && <Alert tone="success">Lesson deleted.</Alert>}
        {unpublished > 0 && (
          <Alert tone="warning" title={`${unpublished} unpublished ${unpublished === 1 ? "lesson" : "lessons"}`}>
            Customers can&rsquo;t see lessons marked &ldquo;Unpublished&rdquo; below.
          </Alert>
        )}

        {modules.length === 0 && (
          <EmptyState title="No modules yet">Add the first module below. Lessons are added inside a module.</EmptyState>
        )}

        <ol className="space-y-6" aria-label="Modules">
          {modules.map((mod, mi) => {
            const modLessons = sortByPosition(lessons.filter((l) => l.module_id === mod.id));
            return (
              <li key={mod.id}>
                <Panel
                  title={`Module ${mi + 1}: ${mod.title}`}
                  description={mod.summary ?? undefined}
                  actions={
                    <div className="flex flex-wrap gap-2">
                      <MoveButtons
                        action={moveModule}
                        id={mod.id}
                        label={`module ${mod.title}`}
                        isFirst={mi === 0}
                        isLast={mi === modules.length - 1}
                      />
                      <LinkButton href={`/admin/course/lessons/new?module=${mod.id}`}>Add lesson</LinkButton>
                    </div>
                  }
                >
                  {modLessons.length === 0 ? (
                    <p className="text-sm text-ink-muted">No lessons in this module yet.</p>
                  ) : (
                    <ol className="divide-y divide-line" aria-label={`Lessons in ${mod.title}`}>
                      {modLessons.map((lesson, li) => (
                        <li key={lesson.id} className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 lg:flex-row lg:items-center lg:justify-between">
                          <div className="min-w-0">
                            <p className="font-medium">
                              <span className="text-ink-muted">{li + 1}. </span>
                              {lesson.title}
                            </p>
                            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
                              {lesson.is_published ? <Badge tone="accent">Published</Badge> : <Badge tone="amber">Unpublished</Badge>}
                              {lesson.is_preview && <Badge>Free preview</Badge>}
                              {!lesson.video_provider && <Badge tone="danger">No video</Badge>}
                              <span>/{lesson.slug}</span>
                              {formatDuration(lesson.duration_seconds) && <span>{formatDuration(lesson.duration_seconds)}</span>}
                              <span>
                                {lesson.course_resources?.[0]?.count ?? 0} downloads
                              </span>
                            </div>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <MoveButtons
                              action={moveLesson}
                              id={lesson.id}
                              label={`lesson ${lesson.title}`}
                              isFirst={li === 0}
                              isLast={li === modLessons.length - 1}
                            />
                            <form action={setLessonPublished}>
                              <input type="hidden" name="id" value={lesson.id} />
                              <input type="hidden" name="publish" value={lesson.is_published ? "0" : "1"} />
                              <SubmitButton variant="secondary" pendingText="Saving…" aria-label={`${lesson.is_published ? "Unpublish" : "Publish"} ${lesson.title}`}>
                                {lesson.is_published ? "Unpublish" : "Publish"}
                              </SubmitButton>
                            </form>
                            <Link href={`/admin/course/lessons/${lesson.id}`} className={buttonClasses("secondary")}>
                              Edit<span className="sr-only"> {lesson.title}</span>
                            </Link>
                            {modules.length > 1 && (
                              <form action={moveLessonToModule} className="flex items-center gap-2">
                                <input type="hidden" name="id" value={lesson.id} />
                                <label htmlFor={`move-${lesson.id}`} className="sr-only">
                                  Move {lesson.title} to module
                                </label>
                                <select
                                  id={`move-${lesson.id}`}
                                  name="moduleId"
                                  defaultValue=""
                                  required
                                  className="min-h-10 max-w-44 rounded-md border border-ink/25 bg-card px-2 text-sm"
                                >
                                  <option value="" disabled>
                                    Move to module…
                                  </option>
                                  {modules
                                    .filter((m) => m.id !== mod.id)
                                    .map((m) => (
                                      <option key={m.id} value={m.id}>
                                        Module {modules.indexOf(m) + 1}: {m.title}
                                      </option>
                                    ))}
                                </select>
                                <SubmitButton variant="ghost" pendingText="Moving…">
                                  Move<span className="sr-only"> {lesson.title}</span>
                                </SubmitButton>
                              </form>
                            )}
                          </div>
                        </li>
                      ))}
                    </ol>
                  )}

                  <div className="mt-5 grid gap-3 border-t border-line pt-4 md:grid-cols-2">
                    <details className="rounded-md border border-line p-3">
                      <summary className="cursor-pointer text-sm font-semibold">Edit module details</summary>
                      <div className="mt-3">
                        <ModuleForm action={saveModule} module={mod} />
                      </div>
                    </details>
                    <ConfirmDelete
                      action={deleteModule}
                      id={mod.id}
                      summary="Delete module"
                      warning={
                        modLessons.length > 0
                          ? `This permanently deletes “${mod.title}”, its ${modLessons.length} ${modLessons.length === 1 ? "lesson" : "lessons"}, their downloads and customers' progress.`
                          : `This permanently deletes “${mod.title}”.`
                      }
                      confirmText="Yes, delete this module"
                    />
                  </div>
                </Panel>
              </li>
            );
          })}
        </ol>

        <Panel title="Add a module" description="New modules are added at the end of the course.">
          <ModuleForm action={saveModule} />
        </Panel>
      </div>
    </>
  );
}
