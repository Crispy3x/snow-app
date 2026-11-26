import { canManage, getAppContext } from "@/lib/auth";
import { aiCreditBalance, usage } from "@/lib/limits";
import { createClient } from "@/lib/supabase/server";
import { formatUsd, isSaleActive, PLANS, SALE, salePrice, type PlanKey } from "@/config/plans";
import { START_ERRORS, type StartErrorCode } from "@/lib/billing/start";
import { trialDays } from "@/lib/billing/stripe";
import { Alert, PageHeader, Panel, StatCard } from "@/components/ui/app";
import { Badge } from "@/components/ui/layout";
import { Meter } from "@/components/ui/charts";
import { PlanForm, PortalForm } from "./billing-forms";

export const metadata = { title: "Billing and usage" };

type Sub = {
  id: string;
  plan: PlanKey;
  status: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  trial_end: string | null;
  sale_discount: boolean | null;
  last_payment_failed_at: string | null;
};

const STATUS: Record<string, { label: string; tone: "accent" | "neutral" | "amber" | "danger" }> = {
  active: { label: "Active", tone: "accent" },
  trialing: { label: "Free trial", tone: "accent" },
  past_due: { label: "Payment overdue", tone: "danger" },
  unpaid: { label: "Unpaid", tone: "danger" },
  incomplete: { label: "Awaiting payment", tone: "amber" },
  incomplete_expired: { label: "Checkout expired", tone: "neutral" },
  canceled: { label: "Cancelled", tone: "neutral" },
  paused: { label: "Paused", tone: "amber" },
};
const LIVE = new Set(["active", "trialing", "past_due", "unpaid", "incomplete", "paused"]);
const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : null;

export default async function BillingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await getAppContext();
  const sp = await searchParams;
  const reason = sp.reason;
  const checkout = sp.checkout;
  const errorCode = typeof sp.error === "string" && sp.error in START_ERRORS ? (sp.error as StartErrorCode) : null;

  const supabase = await createClient();
  const [{ data: subRows }, { data: orgRow }, used, credits] = await Promise.all([
    supabase
      .from("subscriptions")
      .select("id, plan, status, current_period_end, cancel_at_period_end, trial_end, sale_discount, last_payment_failed_at")
      .eq("org_id", ctx.org.id)
      .order("updated_at", { ascending: false }),
    supabase.from("organizations").select("stripe_customer_id").eq("id", ctx.org.id).maybeSingle(),
    usage(ctx.org.id),
    aiCreditBalance(ctx.org.id),
  ]);
  const subs = (subRows ?? []) as Sub[];
  const sub = subs.find((s) => LIVE.has(s.status)) ?? null;
  const manage = canManage(ctx.role);
  const saleOn = isSaleActive(new Date());
  const hasCustomer = !!orgRow?.stripe_customer_id;
  const status = sub ? (STATUS[sub.status] ?? { label: sub.status, tone: "neutral" as const }) : null;

  let renewal: string;
  if (!sub) renewal = "No subscription";
  else if (sub.status === "trialing" && sub.trial_end) renewal = `Trial ends ${fmtDate(sub.trial_end)}`;
  else if (sub.cancel_at_period_end) renewal = `Ends ${fmtDate(sub.current_period_end) ?? "at period end"}`;
  else renewal = sub.current_period_end ? `Renews ${fmtDate(sub.current_period_end)}` : "Renews monthly";

  const priceFor = (monthly: number) => (sub?.sale_discount ? salePrice(monthly) : !sub && saleOn ? salePrice(monthly) : monthly);

  return (
    <>
      <PageHeader
        title="Billing and usage"
        description="Your plan, what you're using, and how you pay."
        actions={manage && hasCustomer ? <PortalForm /> : undefined}
      />

      <div className="space-y-6">
        {reason === "no_plan" && (
          <Alert tone="warning" title="Choose a plan to continue">
            That page needs an active plan. Pick one below{ctx.plan ? "" : " to start"}; you can change or cancel any time.
          </Alert>
        )}
        {checkout === "success" && (
          <Alert tone="success" title="Thanks, you're subscribed">
            Your plan is being activated. It shows here within a few seconds; refresh if it doesn&rsquo;t.
          </Alert>
        )}
        {checkout === "cancelled" && <Alert title="Checkout cancelled">No charge was made. You can pick a plan whenever you&rsquo;re ready.</Alert>}
        {errorCode && <Alert tone="danger">{START_ERRORS[errorCode]}</Alert>}
        {sub && (sub.status === "past_due" || sub.status === "unpaid") && (
          <Alert tone="danger" title="Your last payment failed">
            Update your card in Manage billing to keep your plan. Plan features are paused until the payment goes through.
          </Alert>
        )}

        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard
            label="Current plan"
            value={ctx.plan?.name ?? (sub ? (PLANS.find((p) => p.key === sub.plan)?.name ?? "None") : "None")}
            sub={status ? <Badge tone={status.tone}>{status.label}</Badge> : "Choose a plan below"}
          />
          <StatCard label="Billing" value={sub ? `${formatUsd(priceFor(PLANS.find((p) => p.key === sub.plan)?.monthly ?? 0))}/mo` : "–"} sub={renewal} />
          <StatCard
            label={`${SALE.name} discount`}
            value={sub?.sale_discount ? `${SALE.percentOff}% off` : "Not applied"}
            sub={
              sub?.sale_discount
                ? "Locked in for as long as you stay subscribed."
                : saleOn && !sub
                  ? "Subscribe before December 31 to lock it in."
                  : "Only for sign-ups during the sale."
            }
          />
        </div>

        <Panel title="Usage this month" description={ctx.plan ? `Limits on your ${ctx.plan.name} plan.` : "Limits come with your plan."}>
          {ctx.plan ? (
            <div className="grid gap-5 sm:grid-cols-2">
              <Meter label="eBay stores" used={used.stores} max={ctx.plan.limits.stores} />
              <Meter label="Active listings" used={used.listings} max={ctx.plan.limits.listings} />
              <Meter label="Team seats" used={used.seats} max={ctx.plan.limits.seats} />
              <Meter label="AI credits" used={credits.used} max={credits.allowance} />
            </div>
          ) : (
            <p className="text-ink-muted">Pick a plan to see your store, listing, seat and AI credit allowances.</p>
          )}
          {ctx.plan && <p className="mt-4 text-sm text-ink-muted">AI credits reset on the 1st of each month. {credits.remaining.toLocaleString()} left.</p>}
        </Panel>

        <section aria-labelledby="plans-heading" className="space-y-3">
          <div>
            <h2 id="plans-heading" className="text-lg font-semibold">
              {sub ? "Change plan" : "Choose a plan"}
            </h2>
            {!manage && <p className="text-sm text-ink-muted">Only the workspace owner or an admin can change the plan.</p>}
            {sub && manage && (
              <p className="text-sm text-ink-muted">Switching takes effect now; the difference is prorated on your next invoice.</p>
            )}
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {PLANS.map((p) => {
              const current = sub?.plan === p.key;
              const price = priceFor(p.monthly);
              const discounted = price !== p.monthly;
              return (
                <div key={p.key} className={`flex flex-col rounded-lg border bg-card p-5 ${current ? "border-accent" : "border-line"}`}>
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-lg font-semibold">{p.name}</h3>
                    {current ? <Badge tone="accent">Current</Badge> : p.badge ? <Badge>{p.badge}</Badge> : null}
                  </div>
                  <p className="mt-2">
                    <span className="font-display text-2xl font-semibold">{formatUsd(price)}</span>
                    <span className="text-ink-muted">/mo</span>
                    {discounted && <span className="ml-2 text-sm text-ink-muted line-through">{formatUsd(p.monthly)}</span>}
                  </p>
                  <ul className="mt-3 flex-1 space-y-1 text-sm text-ink-muted">
                    <li>{p.limits.stores.toLocaleString()} eBay store{p.limits.stores === 1 ? "" : "s"}</li>
                    <li>{p.limits.listings.toLocaleString()} active listings</li>
                    <li>{p.limits.seats.toLocaleString()} team seat{p.limits.seats === 1 ? "" : "s"}</li>
                    <li>{p.limits.aiCreditsPerMonth.toLocaleString()} AI credits a month</li>
                    {p.limits.course && <li>Video course included</li>}
                    {p.limits.mentorship && <li>Weekly mentorship calls and store audits</li>}
                  </ul>
                  <div className="mt-4">
                    {manage && !current && (
                      <PlanForm
                        plan={p.key}
                        label={sub ? `Switch to ${p.name}` : subs.length === 0 && trialDays() > 0 ? "Start free trial" : `Subscribe to ${p.name}`}
                        variant={p.highlight ? "primary" : "secondary"}
                        pendingText={sub ? "Switching…" : "Opening checkout…"}
                        confirmText={sub ? `Switch to ${p.name}? The price difference is prorated on your next invoice.` : undefined}
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </>
  );
}
