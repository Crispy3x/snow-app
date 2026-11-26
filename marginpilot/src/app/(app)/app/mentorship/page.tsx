import Link from "next/link";
import { getAppContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { Alert, EmptyState, PageHeader, Panel } from "@/components/ui/app";
import { LinkButton, buttonClasses } from "@/components/ui/button";
import { Badge } from "@/components/ui/layout";
import { LockedMentorship } from "@/components/mentorship/locked";
import { LocalTime } from "@/components/mentorship/local-time";
import { AuditRequestForm } from "@/components/mentorship/audit-request-form";
import { planHasMentorship } from "@/lib/directory/entitlement";
import { auditRequestWindow, weekLabel } from "@/lib/mentorship/iso-week";
import { groupSessions, isLive } from "@/lib/mentorship/sessions";
import { bookingUrl, resourcesWithLinks, type ResourceRow } from "@/lib/mentorship/server";
import type { AuditStatus, SessionStatus } from "@/lib/mentorship/validation";

export const metadata = { title: "Mentorship" };

type SessionRow = {
  id: string;
  title: string;
  description: string | null;
  starts_at: string;
  duration_min: number;
  join_url: string | null;
  recording_url: string | null;
  status: SessionStatus;
};

type AuditRow = {
  id: string;
  store_id: string;
  week_of: string;
  seller_notes: string | null;
  status: AuditStatus;
  feedback: string | null;
  delivered_at: string | null;
  created_at: string;
};

const AUDIT_BADGE: Record<AuditStatus, { tone: "neutral" | "amber" | "accent"; label: string }> = {
  requested: { tone: "neutral", label: "Requested" },
  in_review: { tone: "amber", label: "In review" },
  delivered: { tone: "accent", label: "Feedback ready" },
};

export default async function MentorshipPage() {
  const ctx = await getAppContext();
  const entitled = planHasMentorship(ctx.org.plan);
  const canView = entitled || ctx.user.isAdmin;
  const header = (
    <PageHeader
      title="Mentorship"
      description="Weekly group calls, recordings, resources and a written audit of your store every week."
    />
  );
  if (!canView) {
    return (
      <>
        {header}
        <LockedMentorship />
      </>
    );
  }

  const supabase = await createClient();
  const [sessionsRes, resourcesRes, auditsRes] = await Promise.all([
    supabase
      .from("mentorship_sessions")
      .select("id, title, description, starts_at, duration_min, join_url, recording_url, status")
      .order("starts_at", { ascending: false })
      .limit(200),
    supabase.from("mentorship_resources").select("id, title, description, url, storage_path, file_name, sort_order").order("sort_order").order("created_at"),
    supabase
      .from("store_audit_requests")
      .select("id, store_id, week_of, seller_notes, status, feedback, delivered_at, created_at")
      .eq("org_id", ctx.org.id)
      .order("week_of", { ascending: false })
      .limit(52),
  ]);
  const now = new Date();
  const { upcoming, past, cancelled } = groupSessions((sessionsRes.data ?? []) as SessionRow[], now);
  // Signed links are created with the service role, only after the entitlement check above.
  const resources = await resourcesWithLinks(createAdminClient(), (resourcesRes.data ?? []) as ResourceRow[]);
  const audits = (auditsRes.data ?? []) as AuditRow[];
  const win = auditRequestWindow(audits, now);
  const storeLabel = (id: string) => {
    const s = ctx.stores.find((x) => x.id === id);
    return s ? (s.label ?? s.ebay_username ?? "Store") : "Disconnected store";
  };
  const booking = bookingUrl();

  return (
    <>
      {header}
      <div className="grid gap-6">
        {!entitled && (
          <Alert tone="info" title="Admin preview">
            Your workspace isn&apos;t on the Mentorship plan; you can see this because you&apos;re a platform admin. Manage content in{" "}
            <Link href="/admin/mentorship" className="underline">admin</Link>.
          </Alert>
        )}

        <Panel
          title="Upcoming calls"
          description="Times are shown in your time zone."
          actions={
            booking ? (
              <a href={booking} target="_blank" rel="noopener noreferrer" className={buttonClasses("secondary")}>
                Book a 1:1 slot
              </a>
            ) : undefined
          }
        >
          {upcoming.length === 0 ? (
            <p className="text-ink-muted">No calls are scheduled right now. New weekly calls appear here as soon as our team schedules them.</p>
          ) : (
            <ul className="divide-y divide-line" aria-label="Upcoming calls">
              {upcoming.map((s) => {
                const live = isLive(s, now);
                return (
                  <li key={s.id} className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="font-semibold">
                        {s.title} {live && <Badge tone="accent">Live now</Badge>}
                      </p>
                      <p className="text-sm text-ink-muted">
                        <LocalTime iso={s.starts_at} /> · {s.duration_min} min
                      </p>
                      {s.description && <p className="mt-2 whitespace-pre-line text-sm">{s.description}</p>}
                    </div>
                    {s.join_url ? (
                      <a href={s.join_url} target="_blank" rel="noopener noreferrer" className={buttonClasses(live ? "primary" : "secondary")}>
                        Join call<span className="sr-only">: {s.title}</span>
                      </a>
                    ) : (
                      <span className="text-sm text-ink-muted">Join link coming soon</span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {cancelled.length > 0 && (
            <div className="mt-4 border-t border-line pt-4">
              <h3 className="text-sm font-semibold">Cancelled</h3>
              <ul className="mt-2 grid gap-1 text-sm text-ink-muted">
                {cancelled.map((s) => (
                  <li key={s.id}>
                    <span className="line-through">{s.title}</span> · <LocalTime iso={s.starts_at} />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Panel>

        <section id="audits" aria-labelledby="audits-heading" className="grid gap-4 scroll-mt-20">
          <h2 id="audits-heading" className="text-xl font-semibold">Weekly store audit</h2>
          <Panel title={`This week: ${weekLabel(win.weekOf)}`}>
            {!entitled ? (
              <p className="text-sm text-ink-muted">Requests are made by Mentorship workspaces.</p>
            ) : !win.allowed && win.current ? (
              <p className="text-sm">
                Your workspace has requested this week&apos;s audit for {storeLabel(win.current.store_id)}. Status:{" "}
                <Badge tone={AUDIT_BADGE[win.current.status].tone}>{AUDIT_BADGE[win.current.status].label}</Badge>. You can request the next one
                from {weekLabel(win.nextWeekOf)}.
              </p>
            ) : ctx.stores.length === 0 ? (
              <EmptyState title="Connect a store first" action={<LinkButton href="/app/stores">Connect a store</LinkButton>}>
                The audit looks at one of your eBay stores, so connect one before requesting it.
              </EmptyState>
            ) : (
              <div className="grid gap-3">
                <p className="text-sm text-ink-muted">
                  One audit per workspace each week (Monday to Sunday, UTC). A mentor reviews the store and writes feedback you&apos;ll find below.
                </p>
                <AuditRequestForm
                  stores={ctx.stores.map((s) => ({ id: s.id, label: s.label ?? s.ebay_username ?? "Store" }))}
                  defaultStoreId={ctx.store?.id ?? null}
                />
              </div>
            )}
          </Panel>

          {audits.length === 0 ? (
            <p className="text-ink-muted">No audits yet. Written feedback from each audit is kept here.</p>
          ) : (
            <ul className="grid gap-4" aria-label="Audit history">
              {audits.map((a) => (
                <li key={a.id} className="rounded-lg border border-line bg-card p-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold">{weekLabel(a.week_of)}</h3>
                    <Badge tone={AUDIT_BADGE[a.status].tone}>{AUDIT_BADGE[a.status].label}</Badge>
                    <span className="text-sm text-ink-muted">{storeLabel(a.store_id)}</span>
                  </div>
                  {a.seller_notes && (
                    <p className="mt-2 text-sm text-ink-muted">
                      <span className="font-medium text-ink">Your notes: </span>
                      {a.seller_notes}
                    </p>
                  )}
                  {a.status === "delivered" && a.feedback ? (
                    <div className="mt-3 border-t border-line pt-3">
                      <p className="text-sm text-ink-muted">
                        Delivered {a.delivered_at ? <LocalTime iso={a.delivered_at} withWeekday={false} /> : null}
                      </p>
                      <div className="mt-2 whitespace-pre-line">{a.feedback}</div>
                    </div>
                  ) : (
                    <p className="mt-2 text-sm text-ink-muted">Feedback will appear here when the mentor delivers it.</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <Panel title="Past calls and recordings">
          {past.length === 0 ? (
            <p className="text-ink-muted">No past calls yet. Recordings are added here after each call.</p>
          ) : (
            <ul className="divide-y divide-line" aria-label="Past calls">
              {past.map((s) => (
                <li key={s.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="font-medium">{s.title}</p>
                    <p className="text-sm text-ink-muted">
                      <LocalTime iso={s.starts_at} withWeekday={false} />
                    </p>
                  </div>
                  {s.recording_url ? (
                    <a href={s.recording_url} target="_blank" rel="noopener noreferrer" className={buttonClasses("secondary")}>
                      Watch recording<span className="sr-only">: {s.title}</span>
                    </a>
                  ) : (
                    <span className="text-sm text-ink-muted">Recording not available yet</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Resources">
          {resources.length === 0 ? (
            <p className="text-ink-muted">No resources yet. Templates, checklists and links shared by the mentors will be listed here.</p>
          ) : (
            <ul className="grid gap-3" aria-label="Resources">
              {resources.map((r) => (
                <li key={r.id} className="rounded-md border border-line p-3">
                  {r.href ? (
                    <a href={r.href} target="_blank" rel="noopener noreferrer" className="font-medium text-accent underline underline-offset-2">
                      {r.title}
                    </a>
                  ) : (
                    <span className="font-medium">{r.title}</span>
                  )}
                  {r.file_name && <span className="ml-2 text-sm text-ink-muted">({r.file_name})</span>}
                  {r.description && <p className="mt-1 text-sm text-ink-muted">{r.description}</p>}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}
