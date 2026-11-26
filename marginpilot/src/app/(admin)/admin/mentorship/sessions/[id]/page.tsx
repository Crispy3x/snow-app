import Link from "next/link";
import { notFound } from "next/navigation";
import { adminContext } from "@/lib/admin/server";
import { PageHeader, Panel } from "@/components/ui/app";
import { ConfirmDelete } from "@/components/course/admin/confirm-delete";
import { SessionForm, type SessionValues } from "@/components/mentorship/admin-forms";
import { deleteSession } from "../../actions";

export const metadata = { title: "Edit session" };

export default async function EditSessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { db } = await adminContext();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { data } = await db
    .from("mentorship_sessions")
    .select("id, title, description, starts_at, duration_min, join_url, recording_url, status")
    .eq("id", id)
    .maybeSingle();
  if (!data) notFound();
  const session = data as SessionValues;
  return (
    <>
      <p className="mb-2 text-sm">
        <Link href="/admin/mentorship" className="text-accent underline underline-offset-2">
          Mentorship
        </Link>
      </p>
      <PageHeader title={session.title} description="Edit the session, mark it done, or add the recording link after the call." />
      <div className="grid gap-6">
        <Panel>
          <SessionForm session={session} />
        </Panel>
        <ConfirmDelete
          action={deleteSession}
          id={session.id}
          summary="Delete this session"
          warning="Members will no longer see it, including its recording. To keep it visible as cancelled, set the status to Cancelled instead."
          confirmText="Delete session"
        />
      </div>
    </>
  );
}
