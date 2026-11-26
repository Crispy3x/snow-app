import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { PageHeader, Panel } from "@/components/ui/app";
import { LinkButton } from "@/components/ui/button";
import { Badge } from "@/components/ui/layout";
import { icons } from "@/components/ui/icons";
import { CourseProgress } from "@/components/course/course-progress";
import { UpgradePrompt } from "@/components/course/upgrade-prompt";
import { hasCourseAccess } from "@/lib/course/access";
import { getCourseOutline, getMyProgress } from "@/lib/course/data";
import { courseCompletion, pickContinueLesson } from "@/lib/course/progress";
import { formatDuration, spokenDuration } from "@/lib/course/video";
import { formatResume } from "@/lib/course/format";

export const metadata = { title: "Course" };

export default async function CoursePage() {
  const user = await requireUser("/app/course");
  const [access, outline, progress] = await Promise.all([
    hasCourseAccess(user.id),
    getCourseOutline(),
    getMyProgress(),
  ]);
  const entitled = access || user.isAdmin;
  const completedIds = new Set(progress.filter((p) => p.completed_at).map((p) => p.lesson_id));
  const completion = courseCompletion(outline.lessons, progress);
  const next = entitled ? pickContinueLesson(outline.lessons, progress) : null;
  const firstPreview = outline.lessons.find((l) => l.is_preview);

  return (
    <>
      <PageHeader
        title="Course"
        description="Six modules on running an eBay store with clear margins, from account setup to running several stores."
      />

      <div className="space-y-6">
        {!entitled && (
          <>
            <UpgradePrompt />
            {firstPreview && (
              <p className="text-sm">
                Start with a free preview:{" "}
                <Link
                  href={`/app/course/${firstPreview.slug}`}
                  className="font-medium text-accent underline underline-offset-2 hover:text-accent-strong"
                >
                  {firstPreview.title}
                </Link>
              </p>
            )}
          </>
        )}

        {entitled && outline.lessons.length > 0 && (
          <Panel title="Your progress">
            <div className="space-y-4">
              <CourseProgress completed={completion.completed} total={completion.total} />
              {next ? (
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm">
                    <span className="text-ink-muted">Continue where you left off: </span>
                    <span className="font-medium">{next.lesson.title}</span>
                    {next.resumeAt > 5 && <span className="text-ink-muted"> (at {formatResume(next.resumeAt)})</span>}
                  </p>
                  <LinkButton href={`/app/course/${next.lesson.slug}`}>
                    {completion.completed === 0 && next.resumeAt === 0 ? "Start the course" : "Continue"}
                  </LinkButton>
                </div>
              ) : (
                <p className="text-sm font-medium text-accent-strong">You&rsquo;ve completed every lesson. Well done.</p>
              )}
            </div>
          </Panel>
        )}

        <ol className="space-y-4" aria-label="Course modules">
          {outline.modules.map((mod, mi) => {
            const lessons = outline.lessons.filter((l) => l.module_id === mod.id);
            const done = lessons.filter((l) => completedIds.has(l.id)).length;
            return (
              <li key={mod.id}>
                <section aria-labelledby={`module-${mod.id}`} className="rounded-lg border border-line bg-card">
                  <div className="border-b border-line px-5 py-4">
                    <p className="text-sm font-medium text-ink-muted">Module {mi + 1}</p>
                    <h2 id={`module-${mod.id}`} className="text-lg font-semibold">
                      {mod.title}
                    </h2>
                    {mod.summary && <p className="mt-1 max-w-2xl text-sm text-ink-muted">{mod.summary}</p>}
                    {entitled && lessons.length > 0 && (
                      <p className="mt-2 text-xs text-ink-muted">
                        {done} of {lessons.length} lessons completed
                      </p>
                    )}
                  </div>
                  {lessons.length === 0 ? (
                    <p className="px-5 py-4 text-sm text-ink-muted">Lessons for this module are coming soon.</p>
                  ) : (
                    <ol className="divide-y divide-line">
                      {lessons.map((lesson, li) => {
                        const complete = completedIds.has(lesson.id);
                        const locked = !entitled && !lesson.is_preview;
                        const duration = formatDuration(lesson.duration_seconds);
                        return (
                          <li key={lesson.id}>
                            <Link
                              href={`/app/course/${lesson.slug}`}
                              className="flex min-h-12 items-center gap-3 px-5 py-3 hover:bg-paper focus-visible:bg-paper"
                            >
                              <span
                                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs [&_svg]:h-4 [&_svg]:w-4 ${
                                  complete ? "border-accent bg-accent text-white" : "border-ink/25 text-ink-muted"
                                }`}
                              >
                                {complete ? icons.check : li + 1}
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block font-medium">{lesson.title}</span>
                                <span className="sr-only">
                                  {complete ? ", completed" : ""}
                                  {locked ? ", requires the full course" : ""}
                                </span>
                              </span>
                              <span className="flex shrink-0 items-center gap-2">
                                {!entitled && lesson.is_preview && <Badge tone="accent">Free preview</Badge>}
                                {locked && <Badge>Full course</Badge>}
                                {duration && (
                                  <span className="text-sm tabular-nums text-ink-muted">
                                    <span aria-hidden="true">{duration}</span>
                                    <span className="sr-only">{spokenDuration(lesson.duration_seconds)}</span>
                                  </span>
                                )}
                              </span>
                            </Link>
                          </li>
                        );
                      })}
                    </ol>
                  )}
                </section>
              </li>
            );
          })}
        </ol>
      </div>
    </>
  );
}
