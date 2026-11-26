import { getAppContext } from "@/lib/auth";
import { appUrl } from "@/lib/account/url";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { referralLinks } from "@/lib/referrals/code";
import { commissionPctFromEnv, formatCents, type CommissionStatus, type ReferralStatus } from "@/lib/referrals/commission";
import { getOrCreateReferralCode } from "@/lib/referrals/server";
import { Alert, DataTable, EmptyState, PageHeader, Panel, StatCard, td, th } from "@/components/ui/app";
import { Badge } from "@/components/ui/layout";
import { ReferralLink } from "@/components/referrals/referral-link";
import { PayoutTerms } from "@/components/referrals/payout-terms";

export const metadata = { title: "Referrals" };

type Row = {
  id: string;
  referred_label: string;
  status: ReferralStatus;
  first_paid_at: string | null;
  currency: string;
  commission_cents: number;
  commission_status: CommissionStatus | null;
  created_at: string;
};

const STATUS: Record<ReferralStatus, { label: string; tone: "neutral" | "accent" | "amber" | "danger" }> = {
  signed_up: { label: "Signed up", tone: "neutral" },
  converted: { label: "Paying customer", tone: "accent" },
  paid: { label: "Commission paid", tone: "accent" },
  void: { label: "Void", tone: "danger" },
};
const COMMISSION: Record<CommissionStatus, string> = { pending: "Pending review", approved: "Approved", paid: "Paid", void: "Void" };
const date = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

export default async function ReferralsPage() {
  const ctx = await getAppContext();
  let code: string | null = null;
  try {
    code = await getOrCreateReferralCode(createAdminClient(), ctx.user.id);
  } catch (e) {
    console.error("[referrals] code creation failed", e);
  }

  const supabase = await createClient();
  const [{ data: rows }, { data: clickRows }, base] = await Promise.all([
    supabase
      .from("referrals")
      .select("id, referred_label, status, first_paid_at, currency, commission_cents, commission_status, created_at")
      .eq("referrer_user_id", ctx.user.id) // admins can read every row through RLS; show only your own here
      .order("created_at", { ascending: false })
      .limit(500),
    code ? supabase.from("referral_clicks").select("count").eq("code", code) : Promise.resolve({ data: [] as { count: number }[] }),
    appUrl(),
  ]);
  const referrals = (rows ?? []) as Row[];
  const clicks = (clickRows ?? []).reduce((sum, r) => sum + Number(r.count), 0);
  const signups = referrals.length;
  const converted = referrals.filter((r) => r.status === "converted" || r.status === "paid").length;
  const total = (s: CommissionStatus) => referrals.filter((r) => r.commission_status === s).reduce((sum, r) => sum + r.commission_cents, 0);
  const links = code ? referralLinks(base, code) : null;
  const pct = commissionPctFromEnv();

  return (
    <>
      <PageHeader
        title="Referrals"
        description={`Share your link. When someone you refer becomes a paying customer, you earn ${pct}% of their first payment.`}
      />

      <div className="space-y-6">
        <Panel title="Your referral link">
          {links ? (
            <div className="space-y-4">
              <ReferralLink id="ref-link-home" label="Link to the home page" url={links.home} />
              <ReferralLink id="ref-link-signup" label="Link straight to sign-up" url={links.signup} />
              <p className="text-sm text-ink-muted">
                Your code is <span className="font-mono font-semibold text-ink">{code}</span>. It works on any page: add{" "}
                <span className="font-mono">?ref={code}</span> to the address.
              </p>
            </div>
          ) : (
            <Alert tone="danger" title="We couldn't load your referral link">
              Refresh the page in a moment. If it keeps happening, contact support.
            </Alert>
          )}
        </Panel>

        <section aria-label="Referral stats" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <StatCard label="Link visits" value={clicks.toLocaleString("en-US")} sub="Unique visitors, counted once per 60 days" />
          <StatCard label="Sign-ups" value={signups.toLocaleString("en-US")} />
          <StatCard label="Paying customers" value={converted.toLocaleString("en-US")} />
          <StatCard label="Pending commission" value={formatCents(total("pending"))} sub="Waiting for review" />
          <StatCard label="Approved, not yet paid" value={formatCents(total("approved"))} />
          <StatCard label="Paid to you" value={formatCents(total("paid"))} />
        </section>

        <Alert title="Commissions are approved manually">
          Every commission is checked by hand after the refund window ends, then paid out manually. Pending amounts can change
          if a payment is refunded.
        </Alert>

        <Panel title="People you referred" description="Shown by first initial only, to protect their privacy.">
          {referrals.length === 0 ? (
            <EmptyState title="No referrals yet">When someone signs up through your link, they&rsquo;ll show up here.</EmptyState>
          ) : (
            <DataTable caption="People you referred">
              <thead>
                <tr>
                  <th scope="col" className={th}>Person</th>
                  <th scope="col" className={th}>Signed up</th>
                  <th scope="col" className={th}>Status</th>
                  <th scope="col" className={th}>First payment</th>
                  <th scope="col" className={`${th} text-right`}>Commission</th>
                </tr>
              </thead>
              <tbody>
                {referrals.map((r) => (
                  <tr key={r.id}>
                    <td className={td}>{r.referred_label}</td>
                    <td className={td}>{date(r.created_at)}</td>
                    <td className={td}>
                      <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
                    </td>
                    <td className={td}>{r.first_paid_at ? date(r.first_paid_at) : "–"}</td>
                    <td className={`${td} text-right tabular-nums`}>
                      {r.commission_status ? (
                        <>
                          {formatCents(r.commission_cents, r.currency)}
                          <span className="block text-xs text-ink-muted">{COMMISSION[r.commission_status]}</span>
                        </>
                      ) : (
                        "–"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          )}
        </Panel>

        <Panel title="Payout terms">
          <PayoutTerms commissionPct={pct} />
        </Panel>
      </div>
    </>
  );
}
