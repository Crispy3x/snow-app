import { Alert, DataTable, EmptyState, PageHeader, Panel, StatCard, td, th } from "@/components/ui/app";
import { Select } from "@/components/ui/form";
import { Button, buttonClasses } from "@/components/ui/button";
import { Badge } from "@/components/ui/layout";
import { adminContext, formatDate, userEmails } from "@/lib/admin/server";
import { commissionPctFromEnv, formatCents, type CommissionStatus, type ReferralStatus } from "@/lib/referrals/commission";
import { FILTERS, loadReferrals, totalsByReferrer, type Filter } from "./data";
import { ReferralActions } from "./referral-actions";

export const metadata = { title: "Referrals" };

const FILTER_LABEL: Record<Filter, string> = {
  all: "All referrals",
  signed_up: "Signed up, not paying yet",
  pending: "Commission pending",
  approved: "Approved, to pay",
  paid: "Paid",
  void: "Void",
};
const STATUS_TONE: Record<ReferralStatus, "neutral" | "accent" | "amber" | "danger"> = { signed_up: "neutral", converted: "accent", paid: "accent", void: "danger" };
const COMMISSION_TONE: Record<CommissionStatus, "neutral" | "accent" | "amber" | "danger"> = { pending: "amber", approved: "accent", paid: "neutral", void: "danger" };

export default async function AdminReferralsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { db } = await adminContext();
  const sp = await searchParams;
  const raw = typeof sp.status === "string" ? sp.status : "all";
  const filter: Filter = (FILTERS as readonly string[]).includes(raw) ? (raw as Filter) : "all";

  const [{ rows, error }, all] = await Promise.all([loadReferrals(db, filter, 500), loadReferrals(db, "all", 5000)]);
  const totals = totalsByReferrer(all.rows);
  const emails = await userEmails(db, [...totals.slice(0, 50).map((t) => t.userId), ...rows.flatMap((r) => [r.referrer_user_id, r.referred_user_id])]);
  const orgIds = [...new Set(rows.map((r) => r.referred_org_id).filter((x): x is string => !!x))];
  const { data: orgs } = orgIds.length ? await db.from("organizations").select("id, name").in("id", orgIds.slice(0, 500)) : { data: [] };
  const orgName = new Map(((orgs ?? []) as { id: string; name: string }[]).map((o) => [o.id, o.name]));
  const who = (id: string | null) => (id ? (emails.get(id) ?? `${id.slice(0, 8)}…`) : "Deleted user");

  const sum = (s: CommissionStatus) => all.rows.filter((r) => r.commission_status === s).reduce((n, r) => n + r.commission_cents, 0);

  return (
    <>
      <PageHeader
        title="Referrals"
        description={`Commissions are ${commissionPctFromEnv()}% of the first paid invoice (REFERRAL_COMMISSION_PCT), recorded as pending by the Stripe webhook. Approve after the refund window, pay outside the app, then mark paid here.`}
        actions={
          <a href={`/admin/referrals/export?status=${filter}`} className={buttonClasses("secondary")} download>
            Export CSV
          </a>
        }
      />

      {(error || all.error) && (
        <div className="mb-4">
          <Alert tone="danger" title="Couldn't load referrals">{error ?? all.error}</Alert>
        </div>
      )}

      <div className="space-y-6">
        <section aria-label="Commission totals" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Referred sign-ups" value={all.rows.length.toLocaleString("en-US")} />
          <StatCard label="Pending" value={formatCents(sum("pending"))} sub="Waiting for review" />
          <StatCard label="Approved, to pay" value={formatCents(sum("approved"))} />
          <StatCard label="Paid out" value={formatCents(sum("paid"))} />
        </section>

        <Panel title="Totals per referrer">
          {totals.length === 0 ? (
            <EmptyState title="No referrals yet" />
          ) : (
            <DataTable caption="Totals per referrer">
              <thead>
                <tr>
                  <th scope="col" className={th}>Referrer</th>
                  <th scope="col" className={`${th} text-right`}>Sign-ups</th>
                  <th scope="col" className={`${th} text-right`}>Paying</th>
                  <th scope="col" className={`${th} text-right`}>Pending</th>
                  <th scope="col" className={`${th} text-right`}>Approved</th>
                  <th scope="col" className={`${th} text-right`}>Paid</th>
                </tr>
              </thead>
              <tbody>
                {totals.slice(0, 50).map((t) => (
                  <tr key={t.userId}>
                    <td className={td}>{t.userId.startsWith("(") ? t.userId : who(t.userId)}</td>
                    <td className={`${td} text-right tabular-nums`}>{t.signups}</td>
                    <td className={`${td} text-right tabular-nums`}>{t.converted}</td>
                    <td className={`${td} text-right tabular-nums`}>{formatCents(t.pending)}</td>
                    <td className={`${td} text-right tabular-nums`}>{formatCents(t.approved)}</td>
                    <td className={`${td} text-right tabular-nums`}>{formatCents(t.paid)}</td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          )}
        </Panel>

        <Panel
          title="Referrals"
          actions={
            <form method="get" className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <Select id="ref-filter" name="status" label="Show" defaultValue={filter} options={FILTERS.map((f) => ({ value: f, label: FILTER_LABEL[f] }))} />
              <Button type="submit" variant="secondary">
                Apply
              </Button>
            </form>
          }
        >
          {rows.length === 0 ? (
            <EmptyState title="Nothing here">No referrals match this filter.</EmptyState>
          ) : (
            <ul className="divide-y divide-line">
              {rows.map((r) => (
                <li key={r.id} className="py-4 first:pt-0 last:pb-0">
                  <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
                    <div className="min-w-0 space-y-1 text-sm">
                      <p className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold break-all">{who(r.referred_user_id)}</span>
                        <Badge tone={STATUS_TONE[r.status]}>{r.status.replace("_", " ")}</Badge>
                        {r.commission_status && <Badge tone={COMMISSION_TONE[r.commission_status]}>commission {r.commission_status}</Badge>}
                      </p>
                      <p className="text-ink-muted">
                        Workspace {r.referred_org_id ? (orgName.get(r.referred_org_id) ?? r.referred_org_id) : "–"} · signed up {formatDate(r.created_at)}
                      </p>
                      <p className="text-ink-muted break-all">
                        Referred by {who(r.referrer_user_id)} with code <span className="font-mono">{r.code}</span>
                      </p>
                      {r.first_paid_at && (
                        <p>
                          First paid {formatDate(r.first_paid_at)}: {formatCents(r.first_invoice_amount_cents ?? 0, r.currency)} (invoice{" "}
                          <span className="font-mono">{r.first_invoice_id}</span>). Commission{" "}
                          <strong className="tabular-nums">{formatCents(r.commission_cents, r.currency)}</strong>
                          {r.commission_pct != null && ` at ${Number(r.commission_pct)}%`}
                          {r.commission_paid_at && `, paid ${formatDate(r.commission_paid_at)}`}.
                        </p>
                      )}
                      {r.notes && <pre className="mt-2 whitespace-pre-wrap rounded-md bg-paper p-2 font-sans text-xs text-ink">{r.notes}</pre>}
                    </div>
                    <ReferralActions id={r.id} status={r.status} commissionStatus={r.commission_status} label={who(r.referred_user_id)} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}
