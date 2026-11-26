import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { Alert, PageHeader, Panel, TextLink } from "@/components/ui/app";
import { buttonClasses } from "@/components/ui/button";
import { Select, TextInput } from "@/components/ui/form";
import { Badge } from "@/components/ui/layout";
import { SubmitButton } from "@/components/ui/submit-button";
import { ConfirmDelete } from "@/components/course/admin/confirm-delete";
import { LessonForm, type LessonFormValues } from "@/components/course/admin/lesson-form";
import { MoveButtons } from "@/components/course/admin/move-buttons";
import { StorageUpload } from "@/components/course/admin/storage-upload";
import { formatBytes } from "@/lib/course/format";
import { sortByPosition } from "@/lib/course/ordering";
import {
  createUploadUrl,
  deleteLesson,
  deleteResource,
  finishUpload,
  moveResource,
  removeCaptions,
  renameResource,
  saveLesson,
} from "../../actions";

export const metadata = { title: "Edit lesson" };

const KIND_OPTIONS = ["file", "pdf", "spreadsheet", "template", "checklist", "other"].map((k) => ({
  value: k,
  label: k === "pdf" ? "PDF" : k[0].toUpperCase() + k.slice(1),
}));

type ResourceRow = {
  id: string;
  title: string;
  storage_path: string;
  position: number;
  kind: string | null;
  file_name: string | null;
  size_bytes: number | null;
};

export default async function EditLessonPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string }>;
}) {
  await requireAdmin();
  const [{ id }, { created }] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const db = createAdminClient();
  const [{ data: lessonData }, { data: modulesData }, { data: resourcesData }] = await Promise.all([
    db
      .from("course_lessons")
      .select(
        "id, module_id, title, slug, summary, body, video_provider, video_ref, duration_seconds, captions_path, captions_label, is_preview, is_published, updated_at",
      )
      .eq("id", id)
      .maybeSingle(),
    db.from("course_modules").select("id, title").order("position"),
    db
      .from("course_resources")
      .select("id, title, storage_path, position, kind, file_name, size_bytes")
      .eq("lesson_id", id)
      .order("position"),
  ]);
  if (!lessonData) notFound();
  const lesson = lessonData as LessonFormValues & { captions_path: string | null; updated_at: string };
  const modules = (modulesData ?? []) as { id: string; title: string }[];
  const resources = sortByPosition((resourcesData ?? []) as ResourceRow[]);

  return (
    <>
      <PageHeader
        title={lesson.title}
        description={
          <>
            <TextLink href="/admin/course">Back to course content</TextLink>
            {lesson.is_published && (
              <>
                {" · "}
                <TextLink href={`/app/course/${lesson.slug}`}>View as a customer</TextLink>
              </>
            )}
          </>
        }
        actions={lesson.is_published ? <Badge tone="accent">Published</Badge> : <Badge tone="amber">Unpublished</Badge>}
      />

      <div className="space-y-6">
        {created && <Alert tone="success">Lesson created. Add a video, captions and downloads below.</Alert>}

        <Panel title="Lesson details">
          {/* Re-mount after uploads change the video source, so a later save can't overwrite it with stale values. */}
          <LessonForm key={lesson.updated_at} action={saveLesson} modules={modules} lesson={lesson} />
        </Panel>

        <Panel
          title="Video file"
          description="For self-hosted videos. Uploading switches this lesson's video source to the uploaded file and replaces any earlier upload."
        >
          <div className="space-y-6">
            {lesson.video_provider === "storage" && lesson.video_ref && (
              <p className="text-sm">
                Current file: <span className="break-all font-mono text-xs">{lesson.video_ref}</span>
              </p>
            )}
            <StorageUpload
              lessonId={lesson.id}
              folder="video"
              label="Video file (MP4 recommended)"
              accept="video/mp4,video/webm,video/quicktime"
              buttonText="Upload video file"
              createUploadUrl={createUploadUrl}
              finishUpload={finishUpload}
            />
            <div className="border-t border-line pt-4">
              <h3 className="text-base font-semibold">Captions</h3>
              {lesson.captions_path ? (
                <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
                  <span className="break-all font-mono text-xs">{lesson.captions_path}</span>
                  <form action={removeCaptions}>
                    <input type="hidden" name="id" value={lesson.id} />
                    <SubmitButton variant="ghost" pendingText="Removing…">
                      Remove captions
                    </SubmitButton>
                  </form>
                </div>
              ) : (
                <p className="mt-1 text-sm text-ink-muted">No captions yet. Captions are shown for uploaded video files.</p>
              )}
              <div className="mt-3">
                <StorageUpload
                  lessonId={lesson.id}
                  folder="captions"
                  label="Captions file (WebVTT, .vtt)"
                  accept=".vtt,text/vtt"
                  buttonText="Upload captions"
                  createUploadUrl={createUploadUrl}
                  finishUpload={finishUpload}
                />
              </div>
            </div>
          </div>
        </Panel>

        <Panel title="Downloads" description="Only customers with course access can download these, through links that expire after 10 minutes.">
          <div className="space-y-6">
            {resources.length === 0 ? (
              <p className="text-sm text-ink-muted">No downloads for this lesson yet.</p>
            ) : (
              <ol className="divide-y divide-line" aria-label="Downloads">
                {resources.map((r, i) => (
                  <li key={r.id} className="space-y-3 py-3 first:pt-0">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="font-medium">
                          {i + 1}. {r.title}
                        </p>
                        <p className="break-all text-xs text-ink-muted">
                          {[r.kind, r.file_name, formatBytes(r.size_bytes)].filter(Boolean).join(" · ")}
                        </p>
                      </div>
                      <MoveButtons
                        action={moveResource}
                        id={r.id}
                        label={r.title}
                        isFirst={i === 0}
                        isLast={i === resources.length - 1}
                      />
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <details className="rounded-md border border-line p-3">
                        <summary className="cursor-pointer text-sm font-semibold">Rename</summary>
                        <form action={renameResource} className="mt-3 space-y-3">
                          <input type="hidden" name="id" value={r.id} />
                          <TextInput id={`res-title-${r.id}`} name="title" label="Title" defaultValue={r.title} required maxLength={200} />
                          <Select id={`res-kind-${r.id}`} name="kind" label="Type" defaultValue={r.kind ?? "file"} options={KIND_OPTIONS} />
                          <SubmitButton variant="secondary" pendingText="Saving…">
                            Save
                          </SubmitButton>
                        </form>
                      </details>
                      <ConfirmDelete
                        action={deleteResource}
                        id={r.id}
                        summary="Delete download"
                        warning={`This deletes “${r.title}” and its file.`}
                        confirmText="Yes, delete this download"
                      />
                    </div>
                  </li>
                ))}
              </ol>
            )}
            <div className="border-t border-line pt-4">
              <h3 className="mb-3 text-base font-semibold">Add a download</h3>
              <StorageUpload
                lessonId={lesson.id}
                folder="resources"
                label="File"
                buttonText="Upload download"
                createUploadUrl={createUploadUrl}
                finishUpload={finishUpload}
              />
            </div>
          </div>
        </Panel>

        <Panel title="Delete lesson">
          <ConfirmDelete
            action={deleteLesson}
            id={lesson.id}
            extra={{ returnTo: "list" }}
            summary="Delete this lesson"
            warning={`This permanently deletes “${lesson.title}”, its uploaded video, captions and downloads, and customers' progress on it.`}
            confirmText="Yes, delete this lesson"
          />
        </Panel>

        <p>
          <Link href="/admin/course" className={buttonClasses("ghost")}>
            Back to course content
          </Link>
        </p>
      </div>
    </>
  );
}
