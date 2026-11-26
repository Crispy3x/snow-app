import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasCourseAccess } from "@/lib/course/access";
import { sanitizePosition } from "@/lib/course/progress";

/**
 * POST /app/course/progress: playback beacon from the lesson video player.
 * Body (sent as text/plain JSON so sendBeacon works): { lessonId, position, completed? }.
 * Same-origin only; saves through the user's RLS client.
 */

const bodySchema = z.object({
  lessonId: z.uuid(),
  position: z.number().nonnegative(),
  completed: z.boolean().optional(),
});

function sameOrigin(req: NextRequest): boolean {
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") return false;
  const origin = req.headers.get("origin");
  if (!origin) return !!site; // browsers send at least one of these on POST
  try {
    return new URL(origin).host === req.headers.get("host");
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return new NextResponse(null, { status: 403 });

  const user = await getUser();
  if (!user) return new NextResponse(null, { status: 401 });

  let json: unknown;
  try {
    const text = await req.text();
    if (text.length > 1000) return new NextResponse(null, { status: 413 });
    json = JSON.parse(text);
  } catch {
    return new NextResponse(null, { status: 400 });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return new NextResponse(null, { status: 400 });

  if (!(await hasCourseAccess(user.id))) return new NextResponse(null, { status: 403 });

  const { data: lesson } = await createAdminClient()
    .from("course_lessons")
    .select("id, duration_seconds")
    .eq("id", parsed.data.lessonId)
    .eq("is_published", true)
    .maybeSingle();
  if (!lesson) return new NextResponse(null, { status: 404 });

  const position = sanitizePosition(parsed.data.position, lesson.duration_seconds as number | null);
  if (position === null) return new NextResponse(null, { status: 400 });

  const now = new Date().toISOString();
  const row: Record<string, unknown> = {
    user_id: user.id,
    lesson_id: lesson.id,
    last_position_seconds: position,
    updated_at: now,
  };
  if (parsed.data.completed) row.completed_at = now; // never cleared here; "Mark incomplete" does that

  const supabase = await createClient();
  const { error } = await supabase.from("lesson_progress").upsert(row, { onConflict: "user_id,lesson_id" });
  if (error) return new NextResponse(null, { status: 500 });
  return new NextResponse(null, { status: 204 });
}
