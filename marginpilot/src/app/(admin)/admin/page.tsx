import Link from "next/link";
import { PageHeader, Panel, StatCard, TextLink } from "@/components/ui/app";
import { PLANS } from "@/config/plans";
import { adminContext } from "@/lib/admin/server";
import { monthRange, totalUsage, usd, type UsageRow } from "@/lib/admin/usage";

export const metadata = { title: "Admin overview" };

export default async function AdminHome() {
  const { db } = await adminContext();
  const range = monthRange(null);

  const count = (q: PromiseLike<{ count: number | null }>) => Promise.resolve(q).then((r) => r.count ?? 0);

  const [users, orgs, noPlan, perPlan, activeSubs, pendingShots, pendingQuotes, usage] = await Promise.all([
    count(db.from("profiles").select("id", { count: "exact", head: true })),
    count(db.from("organizations").select("id", { count: "exact", head: true })),
    count(db.from("organizations").select("id", { count: "exact", head: true }).eq("plan", "none")),
    Promise.all(
      PLANS.map((p) => count(db.from("organizations").select("id", { count: "exact", head: true }).eq("plan", p.key))),
    ),
    count(db.from("subscriptions").select("id", { count: "exact", head: true }).in("status", ["active", "trialing"])),
    count(db.from("proof_screenshots").select("id", { count: "exact", head: true }).eq("status", "pending")),
    count(db.from("testimonials").select("id", { count: "exact", head: true }).eq("status", "pending")),
    db.rpc("admin_ai_usage", { p_from: range.from, p_to: range.to }),
  ]);

  const ai = totalUsage((usage.data as UsageRow[] | null) ?? []);
  const pending = pendingShots + pendingQuotes;
  const monthLabel = new Date(range.from).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

  return (
    <>
      <PageHeader title="Admin overview" description="Accounts, plans, the proof queue and AI spend at a glance." />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Users" value={users.toLocaleString()} />
        <StatCard label="Active subscriptions" value={activeSubs.toLocaleString()} sub="Active or trialing" />
        <Link href="/admin/proof" className="rounded-lg focus-visible:outline-2">
          <StatCard
            label="Proof items waiting for review"
            value={pending.toLocaleString()}
            sub={`${pendingShots} screenshots, ${pendingQuotes} testimonials`}
          />
        </Link>
        <Link href="/admin/ai-usage" className="rounded-lg focus-visible:outline-2">
          <StatCard
            label={`AI spend, ${monthLabel}`}
            value={usd(ai.costUsd)}
            sub={`${ai.requests.toLocaleString()} requests, ${ai.credits.toLocaleString()} credits`}
          />
        </Link>
      </div>

      {usage.error && (
        <p role="alert" className="mt-4 text-sm font-medium text-danger">
          AI usage couldn&apos;t be loaded: {usage.error.message}. Has migration 0003_admin.sql been applied?
        </p>
      )}

      <Panel title="Organizations by plan" className="mt-6" actions={<TextLink href="/admin/users">All users and plans</TextLink>}>
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-5">
          <div>
            <dt className="text-sm text-ink-muted">Total</dt>
            <dd className="font-display text-xl font-semibold tabular-nums">{orgs.toLocaleString()}</dd>
          </div>
          {PLANS.map((p, i) => (
            <div key={p.key}>
              <dt className="text-sm text-ink-muted">{p.name}</dt>
              <dd className="font-display text-xl font-semibold tabular-nums">{perPlan[i].toLocaleString()}</dd>
            </div>
          ))}
          <div>
            <dt className="text-sm text-ink-muted">No plan</dt>
            <dd className="font-display text-xl font-semibold tabular-nums">{noPlan.toLocaleString()}</dd>
          </div>
        </dl>
      </Panel>
    </>
  );
}
