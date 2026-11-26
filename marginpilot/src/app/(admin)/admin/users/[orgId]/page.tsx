import { notFound } from "next/navigation";
import { Alert, DataTable, PageHeader, Panel, StatCard, TextLink, td, th } from "@/components/ui/app";
import { Badge } from "@/components/ui/layout";
import { SubmitButton } from "@/components/ui/submit-button";
import { adminContext, formatDate, formatDateTime, userEmails } from "@/lib/admin/server";
import { isUuid } from "@/lib/admin/flag-rules";
import { planLabel, statusLabel, subTone } from "@/lib/admin/labels";
import { aiCreditBalance } from "@/lib/limits";
import { clearPlanOverride } from "../actions";
import { AdminToggle, GrantForm, OverrideForm, PlanForm } from "./forms";

export const metadata = { title: "Workspace" };

type Org = {
  id: string;
  name: string;
  owner_id: string;
  plan: string;
  stripe_customer_id: string | null;
  ai_credits_override: number | null;
  plan_manual_override: boolean | null;
  plan_override_note: string | null;
  plan_override_at: string | null;
  created_at: string;
};

export default async function AdminOrgPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { admin, db } = await adminContext();
  const { orgId } = await params;
  if (!isUuid(orgId)) notFound();

  const { data: orgData } = await db.from("organizations").select("*").eq("id", orgId).maybeSingle();
  if (!orgData) notFound();
  const org = orgData as Org;

  const [members, subs, stores, ledger, auditLog, balance] = await Promise.all([
    db.from("memberships").select("user_id, role, created_at").eq("org_id", orgId).order("created_at"),
    db.from("subscriptions").select("id, plan, status, current_period_end, cancel_at_period_end").eq("org_id", orgId).order("updated_at", { ascending: false }),
    db.from("ebay_stores").select("id, label, ebay_username, marketplace_id, status, connected_at").eq("org_id", orgId).order("connected_at"),
    db.from("ai_credit_ledger").select("id, period_start, delta, reason, created_at").eq("org_id", orgId).eq("reason", "admin_grant").order("created_at", { ascending: false }).limit(10),
    db.from("admin_audit_log").select("id, admin_id, action, details, created_at").eq("org_id", orgId).order("created_at", { ascending: false }).limit(15),
    aiCreditBalance(orgId),
  ]);

  type Member = { user_id: string; role: string; created_at: string; profiles?: { full_name: string | null; is_admin: boolean } };
  const memberRows = (members.data ?? []) as Member[];
  // memberships and profiles both reference auth.users, so PostgREST can't embed one in the other.
  if (memberRows.length > 0) {
    const { data: profiles } = await db.from("profiles").select("id, full_name, is_admin").in("id", memberRows.map((m) => m.user_id));
    const byId = new Map(((profiles ?? []) as { id: string; full_name: string | null; is_admin: boolean }[]).map((p) => [p.id, p]));
    memberRows.forEach((m) => (m.profiles = byId.get(m.user_id)));
  }
  type AuditRow = { id: number; admin_id: string | null; action: string; details: Record<string, unknown>; created_at: string };
  const auditRows = (auditLog.data ?? []) as AuditRow[];
  const emails = await userEmails(db, [...memberRows.map((m) => m.user_id), org.owner_id, ...auditRows.map((a) => a.admin_id)]);

  return (
    <>
      <p className="mb-2 text-sm">
        <TextLink href="/admin/users">All workspaces</TextLink>
      </p>
      <PageHeader
        title={org.name}
        description={
          <>
            Owner {emails.get(org.owner_id) ?? "unknown"} · created {formatDate(org.created_at)}
            {org.stripe_customer_id && <> · Stripe customer {org.stripe_customer_id}</>}
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          label="Plan"
          value={planLabel(org.plan)}
          sub={org.plan_manual_override ? `Manual override, ${formatDate(org.plan_override_at)}` : "Set by billing"}
        />
        <StatCard label="AI credits used this month" value={balance.used.toLocaleString()} sub={`of ${balance.allowance.toLocaleString()} allowance`} />
        <StatCard label="AI credits remaining" value={balance.remaining.toLocaleString()} sub="Includes admin grants" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Panel title="Change plan" description="A manual override changes what the workspace can use. It doesn't charge or refund anything in Stripe.">
          {org.plan_manual_override && (
            <div className="mb-4 space-y-3">
              <Alert tone="warning" title="Manual override in place">
                {org.plan_override_note ?? "No reason recorded."} The billing webhook should not change this plan until the override is cleared.
              </Alert>
              <form action={clearPlanOverride}>
                <input type="hidden" name="orgId" value={org.id} />
                <SubmitButton variant="secondary" pendingText="Clearing…">
                  Clear override (let billing set the plan)
                </SubmitButton>
              </form>
            </div>
          )}
          <PlanForm orgId={org.id} plan={org.plan} />
        </Panel>

        <Panel title="AI credits" description="Grant one-off credits for this month, or add extra credits every month.">
          <GrantForm orgId={org.id} />
          <hr className="my-6 border-line" />
          <OverrideForm orgId={org.id} value={org.ai_credits_override} />
          {(ledger.data ?? []).length > 0 && (
            <>
              <h3 className="mt-6 text-sm font-semibold">Recent grants</h3>
              <ul className="mt-2 space-y-1 text-sm">
                {(ledger.data as { id: number; delta: number; period_start: string; created_at: string }[]).map((l) => (
                  <li key={l.id} className="flex justify-between gap-2">
                    <span>
                      +{l.delta.toLocaleString()} for{" "}
                      {new Date(`${l.period_start}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })}
                    </span>
                    <span className="text-ink-muted">{formatDate(l.created_at)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Panel>
      </div>

      <h2 className="mb-3 mt-8 text-lg font-semibold">Members</h2>
      <DataTable caption="Members">
        <thead>
          <tr>
            <th className={th}>Email</th>
            <th className={th}>Role</th>
            <th className={th}>Platform admin</th>
            <th className={th}>Action</th>
          </tr>
        </thead>
        <tbody>
          {memberRows.map((m) => {
            const email = emails.get(m.user_id) ?? m.user_id;
            const isAdmin = !!m.profiles?.is_admin;
            return (
              <tr key={m.user_id}>
                <td className={`${td} break-all`}>
                  {email}
                  {m.profiles?.full_name && <span className="block text-xs text-ink-muted">{m.profiles.full_name}</span>}
                </td>
                <td className={td}>{m.role}</td>
                <td className={td}>{isAdmin ? <Badge tone="accent">Admin</Badge> : <span className="text-ink-muted">No</span>}</td>
                <td className={td}>
                  {m.user_id === admin.id && isAdmin ? (
                    <span className="text-sm text-ink-muted">You</span>
                  ) : (
                    <AdminToggle orgId={org.id} userId={m.user_id} isAdmin={isAdmin} email={email} />
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </DataTable>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <Panel title="Subscriptions">
          {(subs.data ?? []).length === 0 ? (
            <p className="text-sm text-ink-muted">No Stripe subscriptions.</p>
          ) : (
            <ul className="space-y-3 text-sm">
              {(subs.data as { id: string; plan: string; status: string; current_period_end: string | null; cancel_at_period_end: boolean }[]).map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-2">
                  <Badge tone={subTone(s.status)}>{statusLabel(s.status)}</Badge>
                  <span>{planLabel(s.plan)}</span>
                  <span className="text-ink-muted">
                    {s.cancel_at_period_end ? "ends" : "renews"} {formatDate(s.current_period_end)}
                  </span>
                  <span className="w-full break-all text-xs text-ink-muted">{s.id}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="eBay stores">
          {(stores.data ?? []).length === 0 ? (
            <p className="text-sm text-ink-muted">No stores connected.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {(stores.data as { id: string; label: string | null; ebay_username: string | null; marketplace_id: string; status: string; connected_at: string }[]).map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{s.label ?? s.ebay_username ?? "Store"}</span>
                  <span className="text-ink-muted">{s.marketplace_id}</span>
                  <Badge tone={s.status === "active" ? "accent" : s.status === "needs_reauth" ? "amber" : "neutral"}>{statusLabel(s.status)}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel title="Admin changes" className="mt-8">
        {auditRows.length === 0 ? (
          <p className="text-sm text-ink-muted">No admin changes recorded.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {auditRows.map((a) => (
              <li key={a.id}>
                <span className="font-medium">{statusLabel(a.action)}</span>{" "}
                <span className="text-ink-muted">
                  by {a.admin_id ? (emails.get(a.admin_id) ?? "admin") : "admin"} · {formatDateTime(a.created_at)}
                </span>
                <code className="mt-0.5 block break-all text-xs text-ink-muted">{JSON.stringify(a.details)}</code>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}
