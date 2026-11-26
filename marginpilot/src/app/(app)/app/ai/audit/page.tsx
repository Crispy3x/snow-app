import Link from "next/link";
import { requireStore } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { isUuid } from "@/lib/ai-tools/drafts";
import type { AuditMetrics } from "@/lib/ai-tools/audit";
import { Alert, EmptyState, PageHeader, Panel, StatCard, money, pct } from "@/components/ui/app";
import { Badge } from "@/components/ui/layout";
import { SubmitButton } from "@/components/ui/submit-button";
import { AiCredits, DraftBadge } from "@/components/ai-tools/credits";
import { RunAuditButton } from "./run-audit-button";
import { decideAuditItem } from "./actions";

export const metadata = { title: "Listing audit" };

const RECS = ["fix", "reprice", "end", "keep"] as const;
type Rec = (typeof RECS)[number];
const REC_LABEL: Record<Rec, string> = { fix: "Fix", reprice: "Reprice", end: "End", keep: "Keep" };
const REC_TONE: Record<Rec, "amber" | "danger" | "accent" | "neutral"> = { fix: "amber", reprice: "amber", end: "danger", keep: "accent" };

type Item = {
  id: string;
  listing_id: string | null;
  title: string;
  score: number;
  metrics: AuditMetrics;
  issues: string[];
  recommendation: Rec | null;
  reasons: string[];
  suggested_changes: { title?: string | null; price?: number | null; notes?: string | null } | null;
  draft_status: string;
};

/** A queued/running run younger than an hour blocks a new one (older ones are treated as stuck). */
function hasActiveRun(runs: { status: string; created_at: string }[], now = Date.now()) {
  return runs.some((r) => (r.status === "queued" || r.status === "running") && now - Date.parse(r.created_at) < 60 * 60_000);
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ run?: string; rec?: string }> }) {
  const ctx = await requireStore();
  if (!ctx.plan.limits.listingAudit) {
    return (
      <>
        <PageHeader title="Listing audit" description="Scan the store and rank listings to fix, reprice or end, with reasons." />
        <EmptyState title="Listing audit is on Professional and Mentorship" action={<Link href="/app/billing" className="font-semibold text-accent underline">See plans</Link>}>
          Upgrade to scan every listing and get a ranked list of what to fix, reprice or end.
        </EmptyState>
      </>
    );
  }
  const sp = await searchParams;
  const filter = RECS.includes(sp.rec as Rec) ? (sp.rec as Rec) : sp.rec === "all" ? "all" : "reviewed";
  const db = createAdminClient();

  const { data: runs } = await db
    .from("audit_runs")
    .select("id, status, total_listings, analyzed, error, created_at, finished_at")
    .eq("org_id", ctx.org.id)
    .eq("store_id", ctx.store.id)
    .order("created_at", { ascending: false })
    .limit(10);
  const run = (isUuid(sp.run) ? runs?.find((r) => r.id === sp.run) : runs?.[0]) ?? null;
  const active = hasActiveRun(runs ?? []);

  let items: Item[] = [];
  const counts: Record<string, number> = {};
  if (run) {
    const { data } = await db
      .from("audit_items")
      .select("id, listing_id, title, score, metrics, issues, recommendation, reasons, suggested_changes, draft_status")
      .eq("run_id", run.id)
      .eq("org_id", ctx.org.id)
      .order("score", { ascending: true })
      .limit(2000);
    const all = (data ?? []) as Item[];
    for (const i of all) if (i.recommendation) counts[i.recommendation] = (counts[i.recommendation] ?? 0) + 1;
    items = all.filter((i) => (filter === "all" ? true : filter === "reviewed" ? i.recommendation !== null : i.recommendation === filter)).slice(0, 300);
  }
  const base = `/app/ai/audit?${run ? `run=${run.id}&` : ""}rec=`;

  return (
    <>
      <PageHeader
        title="Listing audit"
        description="Scores every active listing on title, photos, item specifics, margin and performance, then gives AI recommendations for the weakest 50."
        actions={<AiCredits orgId={ctx.org.id} tool="listing_audit" perRunNote="Each batch of 25 reviewed listings uses 5." />}
      />

      <div className="grid gap-6">
        <Panel>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="text-sm">
              {run ? (
                <>
                  <p>
                    <span className="font-semibold">Last audit:</span> {new Date(run.created_at).toLocaleString("en-US")} ·{" "}
                    <Badge tone={run.status === "failed" ? "danger" : run.status === "done" ? "accent" : "amber"}>{run.status}</Badge>
                  </p>
                  {(run.status === "queued" || run.status === "running") && (
                    <p className="mt-1 text-ink-muted">
                      Working on it. <Link className="font-medium text-accent underline" href={`/app/ai/audit?run=${run.id}`}>Refresh</Link>
                    </p>
                  )}
                </>
              ) : (
                <p className="text-ink-muted">No audits yet for this store.</p>
              )}
            </div>
            <RunAuditButton disabled={active} />
          </div>
          {run?.error && (
            <div className="mt-4">
              <Alert tone={run.analyzed ? "warning" : "danger"} title={run.analyzed ? "Some listings weren't reviewed" : "AI review didn't run"}>
                {run.error} {run.total_listings > 0 && "The code scores below are still accurate."}
              </Alert>
            </div>
          )}
          {runs && runs.length > 1 && (
            <details className="mt-4 text-sm">
              <summary className="cursor-pointer font-medium">Earlier audits</summary>
              <ul className="mt-2 grid gap-1">
                {runs.map((r) => (
                  <li key={r.id}>
                    <Link className="text-accent underline" href={`/app/ai/audit?run=${r.id}`} aria-current={r.id === run?.id ? "page" : undefined}>
                      {new Date(r.created_at).toLocaleString("en-US")}
                    </Link>{" "}
                    <span className="text-ink-muted">({r.status}, {r.total_listings} listings)</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </Panel>

        {run && run.total_listings > 0 && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {RECS.map((r) => (
              <StatCard key={r} label={REC_LABEL[r]} value={counts[r] ?? 0} sub={`of ${run.analyzed} reviewed`} />
            ))}
          </div>
        )}

        {run && (
          <nav aria-label="Filter by recommendation" className="flex flex-wrap gap-2">
            {(["reviewed", ...RECS, "all"] as const).map((f) => (
              <Link
                key={f}
                href={`${base}${f}`}
                aria-current={filter === f ? "page" : undefined}
                className={`min-h-10 rounded-md border px-3 py-2 text-sm font-medium ${filter === f ? "border-accent bg-accent-soft text-accent-strong" : "border-line bg-card hover:border-ink/40"}`}
              >
                {f === "reviewed" ? "AI reviewed" : f === "all" ? "All scored" : REC_LABEL[f]}
              </Link>
            ))}
          </nav>
        )}

        {run && items.length === 0 && (
          <EmptyState title={run.total_listings === 0 && run.status === "done" ? "No active listings to audit" : "Nothing here"}>
            {run.status === "done" || run.status === "failed" ? "Try a different filter." : "Results will appear when the audit finishes."}
          </EmptyState>
        )}

        {items.length > 0 && (
          <ol className="grid gap-3" aria-label="Listings, lowest score first">
            {items.map((i) => (
              <li key={i.id} className="rounded-lg border border-line bg-card p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="break-words font-semibold">
                      {i.listing_id ? (
                        <Link href={`/app/listings/${i.listing_id}`} className="hover:underline">
                          {i.title}
                        </Link>
                      ) : (
                        i.title
                      )}
                    </p>
                    <p className="mt-1 text-sm text-ink-muted">
                      {money(i.metrics.price)} · margin {i.metrics.marginPct == null ? "unknown" : pct(i.metrics.marginPct)} · {i.metrics.views} views · {i.metrics.sold} sold ·{" "}
                      {i.metrics.watchers} watchers · {i.metrics.ageDays} days · {i.metrics.imageCount} photos · {i.metrics.itemSpecificsCount} specifics
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="rounded border border-line px-2 py-0.5 text-sm font-semibold tabular-nums" aria-label={`Score ${i.score} out of 100`}>
                      {i.score}/100
                    </span>
                    {i.recommendation && <Badge tone={REC_TONE[i.recommendation]}>{REC_LABEL[i.recommendation]}</Badge>}
                    {i.recommendation && <DraftBadge status={i.draft_status} />}
                  </div>
                </div>

                {i.reasons.length > 0 && (
                  <ul className="mt-3 list-disc pl-5 text-sm">
                    {i.reasons.map((r, k) => (
                      <li key={k}>{r}</li>
                    ))}
                  </ul>
                )}
                {i.suggested_changes && (
                  <div className="mt-3 rounded-md border border-line bg-paper p-3 text-sm">
                    {i.suggested_changes.title && (
                      <p>
                        <span className="font-medium">Suggested title:</span> {i.suggested_changes.title}
                      </p>
                    )}
                    {i.suggested_changes.price != null && (
                      <p>
                        <span className="font-medium">Suggested price:</span> {money(i.suggested_changes.price)}
                      </p>
                    )}
                    {i.suggested_changes.notes && <p>{i.suggested_changes.notes}</p>}
                  </div>
                )}
                {!i.recommendation && i.issues.length > 0 && <p className="mt-2 text-sm text-ink-muted">Issues: {i.issues.join("; ")}</p>}

                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                  {i.listing_id && (
                    <>
                      <Link className="font-medium text-accent underline" href={`/app/listings/${i.listing_id}`}>Open listing</Link>
                      {(i.recommendation === "fix" || i.metrics.titleLength < 65) && (
                        <Link className="font-medium text-accent underline" href={`/app/ai/titles?listing=${i.listing_id}`}>Title optimizer</Link>
                      )}
                      {(i.recommendation === "reprice" || i.metrics.marginOk === false) && (
                        <Link className="font-medium text-accent underline" href={`/app/ai/pricing?listing=${i.listing_id}`}>Pricing advisor</Link>
                      )}
                      {i.recommendation === "end" && <Link className="font-medium text-accent underline" href="/app/cleanup">Cleanup</Link>}
                    </>
                  )}
                  {i.recommendation && i.draft_status === "draft" && (
                    <span className="flex gap-2 sm:ml-auto">
                      <form action={decideAuditItem}>
                        <input type="hidden" name="itemId" value={i.id} />
                        <input type="hidden" name="decision" value="approved" />
                        <SubmitButton variant="secondary" pendingText="Saving…">Accept</SubmitButton>
                      </form>
                      <form action={decideAuditItem}>
                        <input type="hidden" name="itemId" value={i.id} />
                        <input type="hidden" name="decision" value="rejected" />
                        <SubmitButton variant="ghost" pendingText="Dismissing…">Dismiss</SubmitButton>
                      </form>
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </>
  );
}
