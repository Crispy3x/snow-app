"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasCourseAccess } from "@/lib/course/access";

const schema = z.object({ lessonId: z.uuid(), slug: z.string().max(120) });

/** Re-checks the user and entitlement; the lesson must be published. */
async function authorise(formData: FormData) {
  const user = await requireUser("/app/course");
  const parsed = schema.safeParse({ lessonId: formData.get("lessonId"), slug: formData.get("slug") });
  if (!parsed.success) return null;
  if (!(await hasCourseAccess(user.id))) return null;
  const { data: lesson } = await createAdminClient()
    .from("course_lessons")
    .select("id, slug")
    .eq("id", parsed.data.lessonId)
    .eq("is_published", true)
    .maybeSingle();
  return lesson ? { user, lesson: lesson as { id: string; slug: string } } : null;
}

function refresh(slug: string) {
  revalidatePath("/app/course");
  revalidatePath(`/app/course/${slug}`);
}

export async function markLessonComplete(formData: FormData) {
  const auth = await authorise(formData);
  if (!auth) return;
  const supabase = await createClient(); // RLS: own row, and has_course_access()
  const now = new Date().toISOString();
  await supabase
    .from("lesson_progress")
    .upsert({ user_id: auth.user.id, lesson_id: auth.lesson.id, completed_at: now, updated_at: now }, { onConflict: "user_id,lesson_id" });
  refresh(auth.lesson.slug);
}

export async function markLessonIncomplete(formData: FormData) {
  const auth = await authorise(formData);
  if (!auth) return;
  const supabase = await createClient();
  await supabase
    .from("lesson_progress")
    .update({ completed_at: null, updated_at: new Date().toISOString() })
    .eq("user_id", auth.user.id)
    .eq("lesson_id", auth.lesson.id);
  refresh(auth.lesson.slug);
}
