import Link from "next/link";
import { Alert, DataTable, EmptyState, PageHeader, td, th } from "@/components/ui/app";
import { Badge } from "@/components/ui/layout";
import { buttonClasses } from "@/components/ui/button";
import { planLabel, statusLabel, subTone } from "@/lib/admin/labels";
import { adminContext, formatDate } from "@/lib/admin/server";
import { escapeLike, monthRange } from "@/lib/admin/usage";

export const metadata = { title: "Users and plans" };

const PAGE_SIZE = 50;

type OrgRow = {
  id: string;
  name: string;
  plan: string;
  plan_manual_override: boolean;
  ai_credits_override: number | null;
  created_at: string;
  owner_id: string;
  owner_email: string | null;
  subscription_status: string | null;
  member_count: number;
  store_count: number;
  credits_used: number;
  total_count: number;
};

export default async function AdminUsersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { db } = await adminContext();
  const sp = await searchParams;
  const q = (typeof sp.q === "string" ? sp.q : "").trim().slice(0, 100);
  const page = Math.max(1, Number(typeof sp.page === "string" ? sp.page : 1) || 1);

  const { data, error } = await db.rpc("admin_org_list", {
    p_search: q ? escapeLike(q) : null,
    p_period_start: monthRange(null).periodStart,
    p_limit: PAGE_SIZE,
    p_offset: (page - 1) * PAGE_SIZE,
  });
  const rows = (data as OrgRow[] | null) ?? [];
  const total = rows[0]?.total_count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const qs = (p: number) => `/admin/users?${new URLSearchParams({ ...(q ? { q } : {}), page: String(p) })}`;

  return (
    <>
      <PageHeader title="Users and plans" description="Every workspace, its owner, plan, subscription and usage this month." />

      <form role="search" action="/admin/users" className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label htmlFor="q" className="mb-1 block text-sm font-medium">
            Search by workspace name, owner email or workspace ID
          </label>
          <input
            id="q"
            name="q"
            type="search"
            defaultValue={q}
            className="block min-h-10 w-full rounded-md border border-ink/25 bg-card px-3 py-2"
          />
        </div>
        <button type="submit" className={buttonClasses("primary")}>
          Search
        </button>
      </form>

      {error && (
        <div className="mb-4">
          <Alert tone="danger" title="Couldn't load workspaces">
            {error.message}. Check that migration 0003_admin.sql has been applied.
          </Alert>
        </div>
      )}

      {!error && rows.length === 0 ? (
        <EmptyState title={q ? "No matching workspaces" : "No workspaces yet"}>
          {q ? "Try part of the name or email." : "Workspaces appear here when people sign up."}
        </EmptyState>
      ) : (
        <DataTable caption="Workspaces">
          <thead>
            <tr>
              <th className={th}>Workspace</th>
              <th className={th}>Owner</th>
              <th className={th}>Plan</th>
              <th className={th}>Subscription</th>
              <th className={`${th} text-right`}>Members</th>
              <th className={`${th} text-right`}>Stores</th>
              <th className={`${th} text-right`}>AI credits used</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => (
              <tr key={o.id}>
                <td className={td}>
                  <Link href={`/admin/users/${o.id}`} className="font-medium text-accent underline underline-offset-2 hover:text-accent-strong">
                    {o.name}
                  </Link>
                  <span className="block text-xs text-ink-muted">Since {formatDate(o.created_at)}</span>
                </td>
                <td className={`${td} break-all`}>{o.owner_email ?? "–"}</td>
                <td className={td}>
                  <span className="flex flex-wrap items-center gap-1">
                    {planLabel(o.plan)}
                    {o.plan_manual_override && <Badge tone="amber">Manual override</Badge>}
                  </span>
                </td>
                <td className={td}>
                  {o.subscription_status ? <Badge tone={subTone(o.subscription_status)}>{statusLabel(o.subscription_status)}</Badge> : <span className="text-ink-muted">None</span>}
                </td>
                <td className={`${td} text-right tabular-nums`}>{Number(o.member_count)}</td>
                <td className={`${td} text-right tabular-nums`}>{Number(o.store_count)}</td>
                <td className={`${td} text-right tabular-nums`}>{Number(o.credits_used).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}

      {pages > 1 && (
        <nav aria-label="Pagination" className="mt-4 flex items-center justify-between gap-2 text-sm">
          {page > 1 ? (
            <Link href={qs(page - 1)} className={buttonClasses("secondary")}>
              Previous
            </Link>
          ) : (
            <span />
          )}
          <span className="text-ink-muted">
            Page {page} of {pages} ({Number(total).toLocaleString()} workspaces)
          </span>
          {page < pages ? (
            <Link href={qs(page + 1)} className={buttonClasses("secondary")}>
              Next
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </>
  );
}
