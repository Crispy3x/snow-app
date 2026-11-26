import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { EmptyState, PageHeader, Panel, TextLink } from "@/components/ui/app";
import { LessonForm } from "@/components/course/admin/lesson-form";
import { saveLesson } from "../../actions";

export const metadata = { title: "New lesson" };

export default async function NewLessonPage({ searchParams }: { searchParams: Promise<{ module?: string }> }) {
  await requireAdmin();
  const { module } = await searchParams;
  const { data } = await createAdminClient().from("course_modules").select("id, title").order("position");
  const modules = (data ?? []) as { id: string; title: string }[];

  return (
    <>
      <PageHeader
        title="New lesson"
        description={
          <>
            New lessons are added at the end of their module as drafts unless you tick Published.{" "}
            <TextLink href="/admin/course">Back to course content</TextLink>
          </>
        }
      />
      {modules.length === 0 ? (
        <EmptyState title="Add a module first">Lessons live inside modules.</EmptyState>
      ) : (
        <Panel>
          <LessonForm
            action={saveLesson}
            modules={modules}
            defaultModuleId={modules.some((m) => m.id === module) ? module : undefined}
          />
          <p className="mt-4 text-sm text-ink-muted">After creating the lesson you can upload a video file, captions and downloads.</p>
        </Panel>
      )}
    </>
  );
}
