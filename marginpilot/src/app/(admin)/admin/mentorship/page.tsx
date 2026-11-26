import Link from "next/link";
import { adminContext } from "@/lib/admin/server";
import { Alert, DataTable, PageHeader, Panel, td, th } from "@/components/ui/app";
import { LinkButton, buttonClasses } from "@/components/ui/button";
import { Badge } from "@/components/ui/layout";
import { MoveButtons } from "@/components/course/admin/move-buttons";
import { LocalTime } from "@/components/mentorship/local-time";
import { ResourceLinkForm, ResourceUpload, SessionForm } from "@/components/mentorship/admin-forms";
import { groupSessions } from "@/lib/mentorship/sessions";
import { weekLabel } from "@/lib/mentorship/iso-week";
import { bookingUrl } from "@/lib/mentorship/server";
import type { AuditStatus, SessionStatus } from "@/lib/mentorship/validation";
import { deleteResource, moveResource, setSessionStatus } from "./actions";

export const metadata = { title: "Mentorship" };

type SessionRow = {
  id: string;
  title: string;
  starts_at: string;
  duration_min: number;
  join_url: string | null;
  recording_url: string | null;
  status: SessionStatus;
};

type AuditRow = {
  id: string;
  week_of: string;
  status: AuditStatus;
  created_at: string;
  delivered_at: string | null;
  organizations: { name: string; plan: string } | null;
  ebay_stores: { label: string | null; ebay_username: string | null } | null;
};

const AUDIT_BADGE: Record<AuditStatus, { tone: "neutral" | "amber" | "accent"; label: string }> = {
  requested: { tone: "amber", label: "New" },
  in_review: { tone: "neutral", label: "In review" },
  delivered: { tone: "accent", label: "Delivered" },
};

export default async function AdminMentorshipPage({ searchParams }: { searchParams: Promise<{ audits?: string; deleted?: string }> }) {
  const { db } = await adminContext();
  const sp = await searchParams;
  const showDelivered = sp.audits === "delivered";
  let auditQuery = db
    .from("store_audit_requests")
    .select("id, week_of, status, created_at, delivered_at, organizations(name, plan), ebay_stores(label, ebay_username)")
    .order("created_at", { ascending: showDelivered ? false : true })
    .limit(100);
  auditQuery = showDelivered ? auditQuery.eq("status", "delivered") : auditQuery.neq("status", "delivered");

  const [sessionsRes, resourcesRes, auditsRes, openCount] = await Promise.all([
    db.from("mentorship_sessions").select("id, title, starts_at, duration_min, join_url, recording_url, status").order("starts_at", { ascending: false }).limit(200),
    db.from("mentorship_resources").select("id, title, url, storage_path, file_name, sort_order").order("sort_order").order("created_at"),
    auditQuery,
    db.from("store_audit_requests").select("id", { count: "exact", head: true }).neq("status", "delivered"),
  ]);
  const now = new Date();
  const { upcoming, past, cancelled } = groupSessions((sessionsRes.data ?? []) as SessionRow[], now);
  const resources = (resourcesRes.data ?? []) as { id: string; title: string; url: string | null; storage_path: string | null; file_name: string | null }[];
  const audits = (auditsRes.data ?? []) as unknown as AuditRow[];
  const needsRecording = past.filter((s) => !s.recording_url).length;

  return (
    <>
      <PageHeader
        title="Mentorship"
        description="Weekly calls, recordings, resources and the store audit queue for Mentorship workspaces. All content here is entered by admins."
      />
      <div className="grid gap-6">
        {sp.deleted === "session" && <Alert tone="success">Session deleted.</Alert>}
        {!bookingUrl() && (
          <Alert tone="info">
            Set <code>MENTORSHIP_BOOKING_URL</code> (https) to show a &ldquo;Book a 1:1 slot&rdquo; button on members&apos; Mentorship page.
          </Alert>
        )}

        <section aria-labelledby="queue-heading" className="grid gap-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <h2 id="queue-heading" className="text-xl font-semibold">
              Store audit queue {openCount.count ? <Badge tone="amber">{openCount.count} open</Badge> : null}
            </h2>
            <nav aria-label="Audit views" className="flex gap-2">
              <Link href="/admin/mentorship" aria-current={!showDelivered ? "page" : undefined} className={buttonClasses(showDelivered ? "ghost" : "secondary")}>
                Open
              </Link>
              <Link href="/admin/mentorship?audits=delivered" aria-current={showDelivered ? "page" : undefined} className={buttonClasses(showDelivered ? "secondary" : "ghost")}>
                Delivered
              </Link>
            </nav>
          </div>
          {audits.length === 0 ? (
            <p className="rounded-lg border border-dashed border-ink/25 bg-card px-4 py-6 text-center text-ink-muted">
              {showDelivered ? "No delivered audits yet." : "No open requests. Mentorship workspaces request one audit per week from their Mentorship page."}
            </p>
          ) : (
            <DataTable caption={showDelivered ? "Delivered audits" : "Open audit requests, oldest first"}>
              <thead>
                <tr>
                  <th className={th}>Workspace</th>
                  <th className={th}>Store</th>
                  <th className={th}>Week</th>
                  <th className={th}>Requested</th>
                  <th className={th}>Status</th>
                  <th className={th}>
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {audits.map((a) => (
                  <tr key={a.id}>
                    <td className={td}>
                      {a.organizations?.name ?? "–"}
                      {a.organizations && a.organizations.plan !== "mentorship" && (
                        <span className="ml-2">
                          <Badge tone="danger">No longer on Mentorship</Badge>
                        </span>
                      )}
                    </td>
                    <td className={td}>{a.ebay_stores?.label ?? a.ebay_stores?.ebay_username ?? "–"}</td>
                    <td className={td}>{weekLabel(a.week_of)}</td>
                    <td className={td}>
                      <LocalTime iso={a.created_at} withWeekday={false} />
                    </td>
                    <td className={td}>
                      <Badge tone={AUDIT_BADGE[a.status].tone}>{AUDIT_BADGE[a.status].label}</Badge>
                    </td>
                    <td className={td}>
                      <LinkButton href={`/admin/mentorship/audits/${a.id}`} variant="secondary">
                        Open<span className="sr-only"> audit for {a.organizations?.name}</span>
                      </LinkButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          )}
        </section>

        <Panel title="Upcoming sessions" description={needsRecording ? `${needsRecording} past ${needsRecording === 1 ? "session needs" : "sessions need"} a recording link.` : undefined}>
          {upcoming.length === 0 ? (
            <p className="text-ink-muted">Nothing scheduled. Members see &ldquo;No calls are scheduled&rdquo; until you add one below.</p>
          ) : (
            <SessionList rows={upcoming} />
          )}
          {cancelled.length > 0 && (
            <div className="mt-4 border-t border-line pt-4">
              <h3 className="mb-2 text-sm font-semibold">Cancelled (still shown to members as cancelled)</h3>
              <SessionList rows={cancelled} />
            </div>
          )}
        </Panel>

        <Panel title="Schedule a session">
          <SessionForm />
        </Panel>

        <Panel title="Past sessions">
          {past.length === 0 ? <p className="text-ink-muted">No past sessions.</p> : <SessionList rows={past} />}
        </Panel>

        <Panel title="Resources" description="Shown to Mentorship members in this order.">
          {resources.length === 0 ? (
            <p className="text-ink-muted">No resources yet.</p>
          ) : (
            <ol className="divide-y divide-line" aria-label="Resources">
              {resources.map((r, i) => (
                <li key={r.id} className="flex flex-col gap-2 py-3 first:pt-0 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="font-medium">{r.title}</p>
                    <p className="break-all text-xs text-ink-muted">{r.url ?? `Uploaded file: ${r.file_name ?? r.storage_path}`}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <MoveButtons action={moveResource} id={r.id} label={r.title} isFirst={i === 0} isLast={i === resources.length - 1} />
                    <form action={deleteResource}>
                      <input type="hidden" name="id" value={r.id} />
                      <button type="submit" className={buttonClasses("ghost")}>
                        Remove<span className="sr-only"> {r.title}</span>
                      </button>
                    </form>
                  </div>
                </li>
              ))}
            </ol>
          )}
          <div className="mt-6 grid gap-6 border-t border-line pt-6 lg:grid-cols-2">
            <div>
              <h3 className="mb-3 font-semibold">Add a link</h3>
              <ResourceLinkForm />
            </div>
            <div>
              <h3 className="mb-3 font-semibold">Upload a file</h3>
              <ResourceUpload />
            </div>
          </div>
        </Panel>
      </div>
    </>
  );
}

function SessionList({ rows }: { rows: SessionRow[] }) {
  return (
    <ul className="divide-y divide-line">
      {rows.map((s) => (
        <li key={s.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="font-medium">{s.title}</p>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
              <LocalTime iso={s.starts_at} />
              <span>{s.duration_min} min</span>
              {s.status === "cancelled" && <Badge tone="danger">Cancelled</Badge>}
              {s.status === "done" && <Badge>Done</Badge>}
              {s.status === "scheduled" && !s.join_url && <Badge tone="amber">No join link</Badge>}
              {s.recording_url ? <Badge tone="accent">Recording</Badge> : null}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {s.status === "scheduled" && (
              <form action={setSessionStatus}>
                <input type="hidden" name="id" value={s.id} />
                <button type="submit" name="status" value="cancelled" className={buttonClasses("ghost")}>
                  Cancel<span className="sr-only"> {s.title}</span>
                </button>
              </form>
            )}
            <LinkButton href={`/admin/mentorship/sessions/${s.id}`} variant="secondary">
              {s.recording_url || s.status !== "done" ? "Edit" : "Add recording"}
              <span className="sr-only"> {s.title}</span>
            </LinkButton>
          </div>
        </li>
      ))}
    </ul>
  );
}
