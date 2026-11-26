import Link from "next/link";
import { getAppContext, canManage, type AppContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fillSeries, lastDays, sellingLimitUsage, summarize, type StoredDay } from "@/lib/dashboard/metrics";
import { Alert, EmptyState, PageHeader, Panel, StatCard, TextLink, money, pct } from "@/components/ui/app";
import { Badge } from "@/components/ui/layout";
import { LinkButton } from "@/components/ui/button";
import { BarChart, LineChart, Meter } from "@/components/ui/charts";

export const metadata = { title: "Dashboard" };

const PERIODS = [7, 30, 90] as const;

const shortDay = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

function Checklist({ ctx }: { ctx: AppContext }) {
  const o = ctx.onboarding;
  const rulesHref = ctx.store ? `/app/stores/${ctx.store.id}/rules` : "/app/stores";
  const steps = [
    { done: !!o.connected_ebay || ctx.stores.length > 0, title: "Connect your eBay store", body: "Sign in with eBay. We never see your password.", href: "/app/stores", cta: "Connect eBay" },
    { done: !!o.set_rules, title: "Set your store rules", body: "Margin floor, fees, ad rates and shipping.", href: rulesHref, cta: "Set rules" },
    { done: !!o.first_batch, title: "List your first batch", body: "Add products from a wholesale supplier and publish.", href: "/app/listings/new", cta: "Add products" },
  ];
  if (steps.every((s) => s.done)) return null;
  const doneCount = steps.filter((s) => s.done).length;
  return (
    <Panel title="Get set up" description={`${doneCount} of ${steps.length} done`}>
      <ol className="space-y-3">
        {steps.map((s, i) => (
          <li key={s.title} className="flex flex-col gap-3 rounded-md border border-line p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <span
                aria-hidden="true"
                className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold ${
                  s.done ? "border-accent bg-accent text-white" : "border-ink/25 text-ink-muted"
                }`}
              >
                {i + 1}
              </span>
              <div>
                <p className="font-medium">
                  {s.title} <span className="sr-only">{s.done ? "(done)" : "(to do)"}</span>
                </p>
                <p className="text-sm text-ink-muted">{s.body}</p>
              </div>
            </div>
            {s.done ? (
              <Badge tone="accent">Done</Badge>
            ) : (
              <LinkButton href={s.href} variant={steps.findIndex((x) => !x.done) === i ? "primary" : "secondary"}>
                {s.cta}
              </LinkButton>
            )}
          </li>
        ))}
      </ol>
    </Panel>
  );
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const [ctx, sp] = await Promise.all([getAppContext(), searchParams]);
  const period = PERIODS.find((p) => String(p) === sp.days) ?? 30;
  const store = ctx.store;

  if (!store) {
    return (
      <>
        <PageHeader title="Dashboard" description="Sales, profit and listings for your eBay store." />
        <div className="space-y-6">
          {!ctx.plan && (
            <Alert tone="warning" title="Choose a plan to get started">
              Connecting stores and listing products needs an active plan. <TextLink href="/app/billing">See plans</TextLink>
            </Alert>
          )}
          <Checklist ctx={ctx} />
          <EmptyState
            title="No eBay store connected yet"
            action={canManage(ctx.role) ? <LinkButton href="/app/stores">Connect an eBay store</LinkButton> : undefined}
          >
            Once a store is connected, your sales, net profit after eBay fees and supplier costs, and selling-limit usage show up here.
          </EmptyState>
        </div>
      </>
    );
  }

  const days = lastDays(period);
  const supabase = await createClient();
  const [{ data: metricRows }, { data: storeRow }, { count: activeCount }] = await Promise.all([
    supabase
      .from("store_daily_metrics")
      .select("day, sales, orders, net_profit, avg_margin_pct")
      .eq("store_id", store.id)
      .gte("day", days[0])
      .lte("day", days[days.length - 1])
      .order("day"),
    supabase.from("ebay_stores").select("selling_limit_amount, selling_limit_quantity").eq("id", store.id).maybeSingle(),
    supabase.from("listings").select("id", { count: "exact", head: true }).eq("store_id", store.id).eq("status", "active"),
  ]);

  // Selling-limit usage needs every active listing's price × quantity (paged; PostgREST caps at 1000 rows).
  const active: { price: number | string; quantity: number }[] = [];
  for (let from = 0; from < (activeCount ?? 0); from += 1000) {
    const { data } = await supabase
      .from("listings")
      .select("price, quantity")
      .eq("store_id", store.id)
      .eq("status", "active")
      .order("id")
      .range(from, from + 999);
    active.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }

  const rows = (metricRows ?? []) as StoredDay[];
  const totals = summarize(rows);
  const series = fillSeries(rows, days);
  const usage = sellingLimitUsage(active);
  const limitAmount = storeRow?.selling_limit_amount != null ? Number(storeRow.selling_limit_amount) : null;
  const limitQty = storeRow?.selling_limit_quantity ?? null;
  const hasData = rows.some((r) => r.orders > 0);
  const name = store.label || store.ebay_username || "eBay store";

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={`${name}, last ${period} days.`}
        actions={
          <nav aria-label="Period" className="flex rounded-md border border-ink/20 bg-card p-1">
            {PERIODS.map((p) => (
              <Link
                key={p}
                href={`/app?days=${p}`}
                aria-current={p === period ? "page" : undefined}
                className={`min-h-9 rounded px-3 py-1.5 text-sm font-medium ${p === period ? "bg-accent text-white" : "text-ink hover:bg-ink/5"}`}
              >
                {p} days
              </Link>
            ))}
          </nav>
        }
      />

      <div className="space-y-6">
        {store.status === "needs_reauth" && (
          <Alert tone="warning" title="Reconnect this store">
            eBay no longer accepts this store&apos;s authorization, so the numbers below may be out of date.{" "}
            <TextLink href="/app/stores">Reconnect</TextLink>
          </Alert>
        )}
        <Checklist ctx={ctx} />

        <section aria-label="Summary" className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <StatCard label="Sales" value={money(totals.sales)} />
          <StatCard label="Orders" value={totals.orders.toLocaleString()} />
          <StatCard label="Net profit" value={money(totals.netProfit)} sub="After eBay fees and supplier cost" />
          <StatCard label="Average margin" value={pct(totals.avgMarginPct)} sub={totals.avgMarginPct === null ? "Needs supplier costs" : undefined} />
          <StatCard label="Active listings" value={(activeCount ?? 0).toLocaleString()} />
        </section>

        <Panel title="eBay selling limits" description="How much of your monthly selling limit your active listings use.">
          {limitAmount === null && limitQty === null ? (
            <p className="text-sm text-ink-muted">Not synced yet. Limits refresh from eBay every 6 hours.</p>
          ) : (
            <div className="space-y-4">
              {limitAmount !== null && <Meter label="Amount" used={usage.amount} max={limitAmount} format={(v) => money(v)} />}
              {limitQty !== null && <Meter label="Items" used={usage.quantity} max={limitQty} />}
            </div>
          )}
        </Panel>

        {!hasData ? (
          <EmptyState title={`No sales in the last ${period} days`}>
            Orders appear here after they sync from eBay. Net profit uses each order&apos;s supplier cost and this store&apos;s rules.
          </EmptyState>
        ) : (
          <div className="grid gap-6 lg:grid-cols-2">
            <Panel title="Daily sales">
              <BarChart title={`Sales per day, last ${period} days`} data={series.map((d) => ({ label: shortDay(d.day), value: d.sales }))} format={(v) => money(v)} />
            </Panel>
            <Panel title="Net profit">
              <LineChart title={`Net profit per day, last ${period} days`} data={series.map((d) => ({ label: shortDay(d.day), value: d.net_profit }))} format={(v) => money(v)} />
            </Panel>
            <Panel title="Orders" className="lg:col-span-2">
              <BarChart title={`Orders per day, last ${period} days`} data={series.map((d) => ({ label: shortDay(d.day), value: d.orders }))} />
            </Panel>
          </div>
        )}
        <p className="text-xs text-ink-muted">
          Figures cover your own store only and refresh every 6 hours. Orders without a supplier cost count towards sales but not profit or margin.
        </p>
      </div>
    </>
  );
}
