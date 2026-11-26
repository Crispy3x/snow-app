import { requireStore } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { DataTable, EmptyState, PageHeader, money, td, th } from "@/components/ui/app";
import { Badge } from "@/components/ui/layout";
import { SubmitButton } from "@/components/ui/submit-button";
import { ActionForm } from "@/components/automation/action-form";
import { LinkTabs } from "@/components/automation/tabs";
import { decideCleanup, scanNow } from "./actions";

export const metadata = { title: "Cleanup" };

type CandidateRow = {
  id: string;
  reason: string;
  status: string;
  created_at: string;
  replacement: { id: string; title: string | null; cost: string | null; stock: number | null } | null;
  listings: { title: string; sku: string; price: string; views: number; sold: number; listed_at: string | null } | null;
};

const ageDays = (iso: string | null) => (iso ? Math.floor((Date.now() - Date.parse(iso)) / 86_400_000) : null);

export default async function CleanupPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const ctx = await requireStore();
  const tab = (await searchParams).tab === "history" ? "history" : "pending";
  const supabase = await createClient();
  const [{ data: rules }, { data }] = await Promise.all([
    supabase.from("store_rules").select("cleanup_after_days, cleanup_queue_replacements").eq("store_id", ctx.store.id).maybeSingle(),
    supabase
      .from("cleanup_candidates")
      .select(
        "id, reason, status, created_at, replacement:supplier_products!cleanup_candidates_replacement_supplier_product_id_fkey(id, title, cost, stock), listings!inner(title, sku, price, views, sold, listed_at, store_id)",
      )
      .eq("org_id", ctx.org.id)
      .eq("listings.store_id", ctx.store.id)
      .filter("status", tab === "pending" ? "eq" : "neq", "pending")
      .order("created_at", { ascending: tab === "pending" })
      .limit(200),
  ]);
  const rows = (data ?? []) as unknown as CandidateRow[];
  const days = rules?.cleanup_after_days as number | null | undefined;

  return (
    <>
      <PageHeader
        title="Cleanup"
        description={
          days
            ? `Listings live for more than ${days} days with no views and no sales. Nothing is ended until you approve it.`
            : "Cleanup is off. Set “end stale listings after N days” in your store rules to turn it on."
        }
        actions={
          days ? (
            <ActionForm action={scanNow} className="flex flex-col items-start gap-2 sm:items-end">
              <SubmitButton variant="secondary" pendingText="Starting…">
                Scan now
              </SubmitButton>
            </ActionForm>
          ) : undefined
        }
      />
      <LinkTabs
        label="Cleanup lists"
        current={tab}
        tabs={[
          { key: "pending", label: "To review", href: "/app/cleanup" },
          { key: "history", label: "History", href: "/app/cleanup?tab=history" },
        ]}
      />

      {rows.length === 0 ? (
        <EmptyState title={tab === "pending" ? "Nothing to clean up" : "No decisions yet"}>
          {tab === "pending" ? "Stale listings are checked once a day." : "Ended and dismissed candidates show up here."}
        </EmptyState>
      ) : (
        <ActionForm action={decideCleanup} messageFirst aria-label="Cleanup candidates">
          <DataTable caption="Cleanup candidates">
            <thead>
              <tr>
                <th className={th} scope="col">Listing</th>
                <th className={th} scope="col">Views</th>
                <th className={th} scope="col">Sold</th>
                <th className={th} scope="col">Age</th>
                <th className={th} scope="col">Suggested replacement</th>
                <th className={th} scope="col">{tab === "pending" ? <span className="sr-only">Actions</span> : "Status"}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td className={td}>
                    <p className="font-medium">{c.listings?.title}</p>
                    <p className="text-xs text-ink-muted">
                      {c.listings?.sku} · {money(c.listings?.price)}
                    </p>
                    <p className="mt-1 text-xs text-ink-muted">{c.reason}</p>
                  </td>
                  <td className={`${td} tabular-nums`}>{c.listings?.views ?? 0}</td>
                  <td className={`${td} tabular-nums`}>{c.listings?.sold ?? 0}</td>
                  <td className={`${td} tabular-nums`}>{ageDays(c.listings?.listed_at ?? null) ?? "–"} days</td>
                  <td className={td}>
                    {c.replacement ? (
                      <div>
                        <p>{c.replacement.title}</p>
                        <p className="text-xs text-ink-muted">
                          Cost {money(c.replacement.cost)} · {c.replacement.stock ?? 0} in stock
                        </p>
                        {tab === "pending" && (
                          <div className="mt-2 flex items-start gap-2">
                            <input id={`replace-${c.id}`} name={`replace:${c.id}`} type="checkbox" defaultChecked className="mt-1 h-4 w-4 accent-accent" />
                            <label htmlFor={`replace-${c.id}`} className="text-sm">
                              Create a draft replacement
                            </label>
                          </div>
                        )}
                      </div>
                    ) : (
                      <span className="text-ink-muted">–</span>
                    )}
                  </td>
                  <td className={td}>
                    {tab === "pending" ? (
                      <div className="flex flex-col gap-2">
                        <SubmitButton name="intent" value={`end:${c.id}`} pendingText="Ending…">
                          End listing
                        </SubmitButton>
                        <SubmitButton name="intent" value={`dismiss:${c.id}`} variant="ghost" pendingText="Working…">
                          Keep
                        </SubmitButton>
                      </div>
                    ) : (
                      <Badge tone={c.status === "applied" ? "accent" : "neutral"}>{c.status === "applied" ? "Ended" : c.status}</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
          {tab === "pending" && (
            <p className="mt-3 text-sm text-ink-muted">
              Ending a listing can be undone from the activity log. Draft replacements go to Listings for you to review and publish.
            </p>
          )}
        </ActionForm>
      )}
    </>
  );
}
