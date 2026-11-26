import Link from "next/link";
import type { ReactNode } from "react";
import { Alert, DataTable, EmptyState, PageHeader, StatCard, td, th } from "@/components/ui/app";
import { Badge } from "@/components/ui/layout";
import { buttonClasses } from "@/components/ui/button";
import { AI_TOOLS, type AiToolKey } from "@/config/ai";
import { isUuid } from "@/lib/admin/flag-rules";
import { aiStatusTone as statusTone } from "@/lib/admin/labels";
import { adminContext, formatDateTime, userEmails } from "@/lib/admin/server";
import { formatTokens, groupUsage, monthRange, totalUsage, usd, type UsageRow, type UsageTotals } from "@/lib/admin/usage";

export const metadata = { title: "AI usage and cost" };

const STATUSES = ["ok", "error", "rate_limited", "refused"] as const;
const RECENT_PAGE = 50;

function toolLabel(tool: string) {
  return AI_TOOLS[tool as AiToolKey]?.label ?? tool;
}

function UsageTable({ caption, first, rows }: { caption: string; first: string; rows: { key: string; label: ReactNode; totals: UsageTotals }[] }) {
  return (
    <section className="mt-8">
      <h2 className="mb-3 text-lg font-semibold">{caption}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-ink-muted">No requests this month.</p>
      ) : (
        <DataTable caption={caption}>
          <thead>
            <tr>
              <th className={th}>{first}</th>
              <th className={`${th} text-right`}>Requests</th>
              <th className={`${th} text-right`}>Input tokens</th>
              <th className={`${th} text-right`}>Output tokens</th>
              <th className={`${th} text-right`}>Cost</th>
              <th className={`${th} text-right`}>Credits</th>
              <th className={`${th} text-right`}>Errors</th>
              <th className={`${th} text-right`}>Refusals</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td className={`${td} break-all`}>{r.label}</td>
                <td className={`${td} text-right tabular-nums`}>{r.totals.requests.toLocaleString()}</td>
                <td className={`${td} text-right tabular-nums`}>{formatTokens(r.totals.inputTokens)}</td>
                <td className={`${td} text-right tabular-nums`}>{formatTokens(r.totals.outputTokens)}</td>
                <td className={`${td} text-right tabular-nums`}>{usd(r.totals.costUsd)}</td>
                <td className={`${td} text-right tabular-nums`}>{r.totals.credits.toLocaleString()}</td>
                <td className={`${td} text-right tabular-nums`}>{r.totals.errors.toLocaleString()}</td>
                <td className={`${td} text-right tabular-nums`}>{r.totals.refusals.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}
    </section>
  );
}

export default async function AiUsagePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { db } = await adminContext();
  const sp = await searchParams;
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const range = monthRange(str("month"));
  const org = isUuid(str("org")) ? str("org") : "";
  const status = (STATUSES as readonly string[]).includes(str("status")) ? str("status") : "";
  const page = Math.max(1, Number(str("page")) || 1);

  let recentQuery = db
    .from("ai_requests")
    .select("id, org_id, user_id, tool, model, status, input_tokens, output_tokens, cost_usd, credits, created_at", { count: "exact" })
    .gte("created_at", range.from)
    .lt("created_at", range.to)
    .order("created_at", { ascending: false })
    .range((page - 1) * RECENT_PAGE, page * RECENT_PAGE - 1);
  if (org) recentQuery = recentQuery.eq("org_id", org);
  if (status) recentQuery = recentQuery.eq("status", status);

  const [usage, recent] = await Promise.all([db.rpc("admin_ai_usage", { p_from: range.from, p_to: range.to }), recentQuery]);

  const all = (usage.data as UsageRow[] | null) ?? [];
  const rows = org ? all.filter((r) => r.org_id === org) : all;
  const totals = totalUsage(rows);
  const byOrg = groupUsage(rows, (r) => r.org_id).slice(0, 100);
  const byUser = groupUsage(rows, (r) => r.user_id ?? "none").slice(0, 50);
  const byTool = groupUsage(rows, (r) => r.tool);
  const byModel = groupUsage(rows, (r) => r.model);

  type Recent = { id: string; org_id: string; user_id: string | null; tool: string; model: string; status: string; input_tokens: number | null; output_tokens: number | null; cost_usd: string | null; credits: number; created_at: string };
  const recentRows = (recent.data ?? []) as Recent[];

  const orgIds = [...new Set([...byOrg.map((o) => o.key), ...recentRows.map((r) => r.org_id), ...(org ? [org] : [])])];
  const { data: orgData } = orgIds.length ? await db.from("organizations").select("id, name").in("id", orgIds) : { data: [] };
  const orgName = new Map(((orgData ?? []) as { id: string; name: string }[]).map((o) => [o.id, o.name]));
  const emails = await userEmails(db, [...byUser.map((u) => u.key).filter((k) => k !== "none"), ...recentRows.map((r) => r.user_id)]);

  // user -> org for the per-user table
  const userOrg = new Map<string, string>();
  rows.forEach((r) => r.user_id && userOrg.set(r.user_id, r.org_id));

  const monthLabel = new Date(range.from).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  const recentTotal = recent.count ?? 0;
  const pages = Math.max(1, Math.ceil(recentTotal / RECENT_PAGE));
  const link = (over: Record<string, string>) => {
    const p = new URLSearchParams({ month: range.month, ...(org ? { org } : {}), ...(status ? { status } : {}), ...over });
    [...p.entries()].forEach(([k, v]) => !v && p.delete(k));
    return `/admin/ai-usage?${p}`;
  };

  return (
    <>
      <PageHeader title="AI usage and cost" description={`Requests, tokens, cost and credits for ${monthLabel} (UTC)${org ? ` for ${orgName.get(org) ?? "one workspace"}` : ""}.`} />

      <form action="/admin/ai-usage" className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end">
        <div>
          <label htmlFor="month" className="mb-1 block text-sm font-medium">Month</label>
          <input id="month" name="month" type="month" defaultValue={range.month} className="block min-h-10 rounded-md border border-ink/25 bg-card px-3 py-2" />
        </div>
        <div>
          <label htmlFor="status" className="mb-1 block text-sm font-medium">Status (recent requests)</label>
          <select id="status" name="status" defaultValue={status} className="block min-h-10 rounded-md border border-ink/25 bg-card px-3 py-2">
            <option value="">All</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{s.replace("_", " ")}</option>
            ))}
          </select>
        </div>
        {org && <input type="hidden" name="org" value={org} />}
        <button type="submit" className={buttonClasses("primary")}>Show</button>
        {org && (
          <Link href={link({ org: "", page: "" })} className={buttonClasses("secondary")}>
            All workspaces
          </Link>
        )}
      </form>

      {usage.error && (
        <div className="mb-4">
          <Alert tone="danger" title="Couldn't load usage">{usage.error.message}. Check that migration 0003_admin.sql has been applied.</Alert>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Cost" value={usd(totals.costUsd)} />
        <StatCard label="Requests" value={totals.requests.toLocaleString()} sub={`${totals.errors} errors, ${totals.refusals} refusals`} />
        <StatCard label="Tokens" value={formatTokens(totals.inputTokens + totals.outputTokens)} sub={`${formatTokens(totals.inputTokens)} in, ${formatTokens(totals.outputTokens)} out, ${formatTokens(totals.cacheReadTokens)} cache read`} />
        <StatCard label="Credits charged" value={totals.credits.toLocaleString()} />
      </div>

      <UsageTable caption="By tool" first="Tool" rows={byTool.map((r) => ({ ...r, label: toolLabel(r.key) }))} />
      <UsageTable caption="By model" first="Model" rows={byModel.map((r) => ({ ...r, label: r.key }))} />
      {!org && (
        <UsageTable
          caption="By workspace"
          first="Workspace"
          rows={byOrg.map((r) => ({
            ...r,
            label: (
              <Link href={link({ org: r.key, page: "" })} className="font-medium text-accent underline underline-offset-2 hover:text-accent-strong">
                {orgName.get(r.key) ?? r.key}
              </Link>
            ),
          }))}
        />
      )}
      <UsageTable
        caption="By user"
        first="User"
        rows={byUser.map((r) => ({
          ...r,
          label:
            r.key === "none" ? (
              <span className="text-ink-muted">No user (background job)</span>
            ) : (
              <>
                {emails.get(r.key) ?? r.key}
                {userOrg.get(r.key) && <span className="block text-xs text-ink-muted">{orgName.get(userOrg.get(r.key)!) ?? ""}</span>}
              </>
            ),
        }))}
      />

      <section className="mt-10">
        <h2 className="mb-3 text-lg font-semibold">Recent requests</h2>
        {recentRows.length === 0 ? (
          <EmptyState title="No requests">Nothing matches this month and filter.</EmptyState>
        ) : (
          <DataTable caption="Recent AI requests">
            <thead>
              <tr>
                <th className={th}>When</th>
                <th className={th}>Workspace / user</th>
                <th className={th}>Tool</th>
                <th className={th}>Status</th>
                <th className={`${th} text-right`}>Tokens</th>
                <th className={`${th} text-right`}>Cost</th>
                <th className={th}>Details</th>
              </tr>
            </thead>
            <tbody>
              {recentRows.map((r) => (
                <tr key={r.id}>
                  <td className={`${td} whitespace-nowrap`}>{formatDateTime(r.created_at)}</td>
                  <td className={`${td} break-all`}>
                    {orgName.get(r.org_id) ?? r.org_id}
                    <span className="block text-xs text-ink-muted">{r.user_id ? (emails.get(r.user_id) ?? r.user_id) : "background job"}</span>
                  </td>
                  <td className={td}>
                    {toolLabel(r.tool)}
                    <span className="block text-xs text-ink-muted">{r.model}</span>
                  </td>
                  <td className={td}><Badge tone={statusTone(r.status)}>{r.status.replace("_", " ")}</Badge></td>
                  <td className={`${td} text-right tabular-nums`}>{formatTokens((r.input_tokens ?? 0) + (r.output_tokens ?? 0))}</td>
                  <td className={`${td} text-right tabular-nums`}>{usd(Number(r.cost_usd ?? 0))}</td>
                  <td className={td}>
                    <Link href={`/admin/ai-usage/${r.id}`} className="font-medium text-accent underline underline-offset-2 hover:text-accent-strong">
                      View<span className="sr-only"> request from {formatDateTime(r.created_at)}</span>
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
        {pages > 1 && (
          <nav aria-label="Recent requests pages" className="mt-4 flex items-center justify-between gap-2 text-sm">
            {page > 1 ? <Link href={link({ page: String(page - 1) })} className={buttonClasses("secondary")}>Newer</Link> : <span />}
            <span className="text-ink-muted">Page {page} of {pages}</span>
            {page < pages ? <Link href={link({ page: String(page + 1) })} className={buttonClasses("secondary")}>Older</Link> : <span />}
          </nav>
        )}
      </section>
    </>
  );
}
