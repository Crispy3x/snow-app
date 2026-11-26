import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { Alert, Panel } from "@/components/ui/app";
import { LinkButton, buttonClasses } from "@/components/ui/button";
import { Badge } from "@/components/ui/layout";
import { SubmitButton } from "@/components/ui/submit-button";
import { LessonBody } from "@/components/course/lesson-body";
import { UpgradePrompt } from "@/components/course/upgrade-prompt";
import { VideoPlayer } from "@/components/course/video-player";
import { hasCourseAccess } from "@/lib/course/access";
import { canViewLesson } from "@/lib/course/access-rule";
import { getCourseOutline, getLessonBySlug, getMyProgress, getResourceLinks } from "@/lib/course/data";
import { formatBytes } from "@/lib/course/format";
import { neighbours } from "@/lib/course/progress";
import { formatDuration, spokenDuration } from "@/lib/course/video";
import { markLessonComplete, markLessonIncomplete } from "../actions";

export const metadata = { title: "Course lesson" };

export default async function LessonPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await requireUser(`/app/course/${slug}`);
  const [lesson, outline, access] = await Promise.all([
    getLessonBySlug(slug),
    getCourseOutline(),
    hasCourseAccess(user.id),
  ]);
  if (!lesson || (!lesson.is_published && !user.isAdmin)) notFound();

  const canView = canViewLesson(lesson, access, user.isAdmin);
  const [progressRows, resources] = await Promise.all([
    access ? getMyProgress() : Promise.resolve([]),
    canView && (access || user.isAdmin) ? getResourceLinks(lesson.id) : Promise.resolve([]),
  ]);
  const progress = progressRows.find((p) => p.lesson_id === lesson.id);
  const completed = !!progress?.completed_at;

  const moduleIndex = outline.modules.findIndex((m) => m.id === lesson.module_id);
  const mod = outline.modules[moduleIndex];
  const { prev, next } = neighbours(outline.lessons, lesson.id);
  const duration = formatDuration(lesson.duration_seconds);

  return (
    <article className="space-y-6">
      <nav aria-label="Breadcrumb" className="text-sm">
        <ol className="flex flex-wrap items-center gap-1 text-ink-muted">
          <li>
            <Link href="/app/course" className="underline underline-offset-2 hover:text-ink">
              Course
            </Link>
          </li>
          {mod && (
            <li>
              <span aria-hidden="true"> / </span>
              Module {moduleIndex + 1}: {mod.title}
            </li>
          )}
        </ol>
      </nav>

      <header>
        <h1 className="text-2xl font-semibold sm:text-3xl">{lesson.title}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-ink-muted">
          {duration && (
            <span>
              <span aria-hidden="true">{duration}</span>
              <span className="sr-only">{spokenDuration(lesson.duration_seconds)}</span>
            </span>
          )}
          {lesson.is_preview && !access && <Badge tone="accent">Free preview</Badge>}
          {completed && <Badge tone="accent">Completed</Badge>}
          {!lesson.is_published && <Badge tone="amber">Unpublished: visible to admins only</Badge>}
        </div>
        {lesson.summary && <p className="mt-3 max-w-2xl text-ink-muted">{lesson.summary}</p>}
      </header>

      {canView ? (
        <>
          <VideoPlayer
            lesson={lesson}
            resumeAt={completed ? 0 : (progress?.last_position_seconds ?? 0)}
            trackProgress={access}
          />

          {access ? (
            <div className="flex flex-wrap items-center gap-3">
              <form action={completed ? markLessonIncomplete : markLessonComplete}>
                <input type="hidden" name="lessonId" value={lesson.id} />
                <input type="hidden" name="slug" value={lesson.slug} />
                <SubmitButton variant={completed ? "secondary" : "primary"} pendingText="Saving…">
                  {completed ? "Mark incomplete" : "Mark complete"}
                </SubmitButton>
              </form>
              <p className="text-sm text-ink-muted" role="status">
                {completed ? "You've completed this lesson." : "Your place in the video is saved as you watch."}
              </p>
            </div>
          ) : (
            !user.isAdmin && <UpgradePrompt compact />
          )}

          <LessonBody body={lesson.body} />

          {(access || user.isAdmin) && resources.length > 0 && (
            <Panel title="Downloads" description="Links are valid for 10 minutes. Reload the page for fresh links.">
              <ul className="divide-y divide-line">
                {resources.map((r) => (
                  <li key={r.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="font-medium">{r.title}</p>
                      <p className="text-xs text-ink-muted">
                        {[r.file_name, formatBytes(r.size_bytes)].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                    {r.url ? (
                      <a href={r.url} className={buttonClasses("secondary")} download>
                        Download<span className="sr-only"> {r.title}</span>
                      </a>
                    ) : (
                      <span className="text-sm text-ink-muted">Not available right now</span>
                    )}
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </>
      ) : (
        <>
          <UpgradePrompt compact />
          {!lesson.is_published && <Alert tone="warning">This lesson is not published yet.</Alert>}
        </>
      )}

      <nav aria-label="Lesson navigation" className="flex flex-col gap-3 border-t border-line pt-6 sm:flex-row sm:justify-between">
        {prev ? (
          <LinkButton href={`/app/course/${prev.slug}`} variant="secondary" className="justify-start text-left">
            <span aria-hidden="true">&larr;</span>
            <span>
              <span className="sr-only">Previous lesson: </span>
              {prev.title}
            </span>
          </LinkButton>
        ) : (
          <LinkButton href="/app/course" variant="ghost">
            Back to the course outline
          </LinkButton>
        )}
        {next ? (
          <LinkButton href={`/app/course/${next.slug}`} variant={completed ? "primary" : "secondary"} className="justify-end text-right">
            <span>
              <span className="sr-only">Next lesson: </span>
              {next.title}
            </span>
            <span aria-hidden="true">&rarr;</span>
          </LinkButton>
        ) : (
          <LinkButton href="/app/course" variant="ghost">
            Back to the course outline
          </LinkButton>
        )}
      </nav>
    </article>
  );
}
