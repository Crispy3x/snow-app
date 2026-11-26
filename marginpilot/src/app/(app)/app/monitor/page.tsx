import { requireStore } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Alert, DataTable, EmptyState, PageHeader, Panel, money, pct, td, th } from "@/components/ui/app";
import { Badge } from "@/components/ui/layout";
import { SubmitButton } from "@/components/ui/submit-button";
import { ActionForm } from "@/components/automation/action-form";
import { LinkTabs } from "@/components/automation/tabs";
import { decideProposals, runCheckNow } from "./actions";

export const metadata = { title: "Price and stock" };

type ProposalRow = {
  id: string;
  action: "reprice" | "out_of_stock" | "flag";
  old_cost: string | null;
  new_cost: string | null;
  old_stock: number | null;
  new_stock: number | null;
  old_price: string | null;
  proposed_price: string | null;
  margin_before_pct: string | null;
  margin_after_pct: string | null;
  reason: string | null;
  status: "pending" | "approved" | "applied" | "dismissed" | "failed";
  created_at: string;
  decided_at: string | null;
  listings: { title: string; sku: string; status: string } | null;
};

const ACTION_LABEL = { reprice: "Reprice", out_of_stock: "Out of stock", flag: "Review" } as const;
const STATUS_TONE = { pending: "amber", approved: "accent", applied: "accent", dismissed: "neutral", failed: "danger" } as const;
const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) : "–";

export default async function MonitorPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const ctx = await requireStore();
  const tab = (await searchParams).tab === "history" ? "history" : "pending";
  const supabase = await createClient();

  const [{ data: rules }, { data: state }, { data: proposals }] = await Promise.all([
    supabase.from("store_rules").select("monitor_action, monitor_interval_hours, reprice_requires_approval, min_net_margin_pct").eq("store_id", ctx.store.id).maybeSingle(),
    supabase.from("store_automation").select("monitor_last_checked_at").eq("store_id", ctx.store.id).maybeSingle(),
    supabase
      .from("monitor_proposals")
      .select(
        "id, action, old_cost, new_cost, old_stock, new_stock, old_price, proposed_price, margin_before_pct, margin_after_pct, reason, status, created_at, decided_at, listings!inner(title, sku, status, store_id)",
      )
      .eq("org_id", ctx.org.id)
      .eq("listings.store_id", ctx.store.id)
      .filter("status", tab === "pending" ? "eq" : "neq", "pending")
      .order(tab === "pending" ? "created_at" : "decided_at", { ascending: tab === "pending", nullsFirst: false })
      .limit(tab === "pending" ? 200 : 100),
  ]);
  const rows = (proposals ?? []) as unknown as ProposalRow[];

  const approval = rules?.reprice_requires_approval ?? true;
  const action = (rules?.monitor_action as keyof typeof ACTION_LABEL | undefined) ?? "flag";
  const interval = rules?.monitor_interval_hours ?? 12;

  return (
    <>
      <PageHeader
        title="Price and stock"
        description="MarginPilot checks your wholesale suppliers' cost and stock. Out-of-stock items are paused automatically; price changes wait for your approval."
        actions={
          <ActionForm action={runCheckNow} className="flex flex-col items-start gap-2 sm:items-end">
            <SubmitButton variant="secondary" pendingText="Starting…">
              Run check now
            </SubmitButton>
          </ActionForm>
        }
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-line bg-card p-4 text-sm">
          <p className="text-ink-muted">Last check</p>
          <p className="mt-1 font-medium">{when(state?.monitor_last_checked_at ?? null)}</p>
          <p className="mt-1 text-ink-muted">Every {interval} hours</p>
        </div>
        <div className="rounded-lg border border-line bg-card p-4 text-sm">
          <p className="text-ink-muted">When margin leaves the target</p>
          <p className="mt-1 font-medium">
            {action === "reprice" ? "Reprice" : action === "out_of_stock" ? "Pause the listing" : "Flag for review"}
          </p>
          <p className="mt-1 text-ink-muted">Floor {pct(rules?.min_net_margin_pct ?? 20)}</p>
        </div>
        <div className="rounded-lg border border-line bg-card p-4 text-sm">
          <p className="text-ink-muted">Price changes</p>
          <p className="mt-1 font-medium">{approval ? "Need your approval" : "Applied automatically"}</p>
          <p className="mt-1 text-ink-muted">Never below the margin floor</p>
        </div>
      </div>

      <LinkTabs
        label="Proposals"
        current={tab}
        tabs={[
          { key: "pending", label: "Pending", href: "/app/monitor" },
          { key: "history", label: "History", href: "/app/monitor?tab=history" },
        ]}
      />

      {tab === "pending" ? (
        rows.length === 0 ? (
          <EmptyState title="Nothing to review">
            When a supplier changes cost enough to move your margin outside the target, a proposal appears here.
          </EmptyState>
        ) : (
          <ActionForm action={decideProposals} messageFirst aria-label="Pending proposals">
            <div className="mb-3 flex flex-wrap gap-2">
              <SubmitButton name="intent" value="approve-selected" pendingText="Applying…">
                Approve selected
              </SubmitButton>
              <SubmitButton name="intent" value="dismiss-selected" variant="secondary" pendingText="Working…">
                Dismiss selected
              </SubmitButton>
            </div>
            <DataTable caption="Pending price proposals">
              <thead>
                <tr>
                  <th className={th} scope="col">
                    <span className="sr-only">Select</span>
                  </th>
                  <th className={th} scope="col">Listing</th>
                  <th className={th} scope="col">Cost</th>
                  <th className={th} scope="col">Price</th>
                  <th className={th} scope="col">Margin</th>
                  <th className={th} scope="col">Reason</th>
                  <th className={th} scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id}>
                    <td className={td}>
                      <input
                        type="checkbox"
                        name="ids"
                        value={p.id}
                        id={`sel-${p.id}`}
                        aria-label={`Select ${p.listings?.title ?? "proposal"}`}
                        className="mt-1 h-4 w-4 accent-accent"
                      />
                    </td>
                    <td className={td}>
                      <p className="font-medium">{p.listings?.title}</p>
                      <p className="text-xs text-ink-muted">
                        {p.listings?.sku} <Badge tone={p.action === "reprice" ? "accent" : "amber"}>{ACTION_LABEL[p.action]}</Badge>
                      </p>
                    </td>
                    <td className={`${td} tabular-nums`}>
                      {money(p.old_cost)} <span aria-hidden="true">→</span>
                      <span className="sr-only">to</span> {money(p.new_cost)}
                    </td>
                    <td className={`${td} tabular-nums`}>
                      {money(p.old_price)} <span aria-hidden="true">→</span>
                      <span className="sr-only">to</span> {p.proposed_price ? money(p.proposed_price) : "no safe price"}
                    </td>
                    <td className={`${td} tabular-nums`}>
                      <span className={Number(p.margin_before_pct) < Number(rules?.min_net_margin_pct ?? 20) ? "font-semibold text-danger" : ""}>
                        {pct(p.margin_before_pct)}
                      </span>{" "}
                      <span aria-hidden="true">→</span>
                      <span className="sr-only">to</span> {pct(p.margin_after_pct)}
                    </td>
                    <td className={`${td} max-w-xs text-ink-muted`}>{p.reason}</td>
                    <td className={td}>
                      <div className="flex flex-col gap-2">
                        <SubmitButton name="intent" value={`approve:${p.id}`} disabled={!p.proposed_price} pendingText="Applying…">
                          Approve
                        </SubmitButton>
                        <SubmitButton name="intent" value={`dismiss:${p.id}`} variant="ghost" pendingText="Working…">
                          Dismiss
                        </SubmitButton>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
            <p className="mt-3 text-sm text-ink-muted">
              Margins are worst case: the highest ad rate for the price tier and your store&apos;s sale discount. Approving re-checks the
              floor with the latest supplier cost before changing anything on eBay.
            </p>
          </ActionForm>
        )
      ) : rows.length === 0 ? (
        <EmptyState title="No decisions yet">Approved and dismissed proposals show up here.</EmptyState>
      ) : (
        <Panel>
          <DataTable caption="Proposal history">
            <thead>
              <tr>
                <th className={th} scope="col">Listing</th>
                <th className={th} scope="col">Price</th>
                <th className={th} scope="col">Status</th>
                <th className={th} scope="col">Decided</th>
                <th className={th} scope="col">Reason</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td className={td}>
                    <p className="font-medium">{p.listings?.title}</p>
                    <p className="text-xs text-ink-muted">{p.listings?.sku}</p>
                  </td>
                  <td className={`${td} tabular-nums`}>
                    {money(p.old_price)} <span aria-hidden="true">→</span>
                    <span className="sr-only">to</span> {money(p.proposed_price)}
                  </td>
                  <td className={td}>
                    <Badge tone={STATUS_TONE[p.status]}>{p.status}</Badge>
                  </td>
                  <td className={td}>{when(p.decided_at ?? p.created_at)}</td>
                  <td className={`${td} max-w-xs text-ink-muted`}>{p.reason}</td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        </Panel>
      )}

      {!approval && (
        <div className="mt-6">
          <Alert tone="warning" title="Automatic repricing is on">
            Price changes from supplier cost are applied without approval. Every change is in the activity log and can be undone.
          </Alert>
        </div>
      )}
    </>
  );
}
