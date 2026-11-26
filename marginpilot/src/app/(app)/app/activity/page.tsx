import Link from "next/link";
import { requirePlan } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { undoBlockReason, type ActivityRow } from "@/lib/automation/undo";
import { EmptyState, PageHeader, Panel } from "@/components/ui/app";
import { Badge } from "@/components/ui/layout";
import { Select, TextInput } from "@/components/ui/form";
import { buttonClasses } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";
import { ActionForm } from "@/components/automation/action-form";
import { undoEntry } from "./actions";

export const metadata = { title: "Activity log" };

const PAGE_SIZE = 50;
const ACTORS = ["automation", "user", "system"];
const ENTITIES = ["listing", "order", "offer", "promotion", "store", "rules", "proposal", "message"];

const ACTION_LABEL: Record<string, string> = {
  price_changed: "Price changed",
  quantity_set: "Quantity changed",
  listing_ended: "Listing ended",
  title_changed: "Title changed",
  ad_bid_changed: "Ad bid changed",
  ad_created: "Ad created",
  campaign_created: "Campaign created",
  offer_sent: "Offer sent to watchers",
  sale_created: "Sale event created",
  tracking_posted: "Tracking posted",
};

type Filters = { store?: string; actor?: string; entity?: string; from?: string; to?: string; page?: string };

function fmt(v: unknown): string {
  if (v === null || v === undefined || v === "") return "–";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function Diff({ before, after }: { before: Record<string, unknown> | null; after: Record<string, unknown> | null }) {
  const keys = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])].filter((k) => k !== "undo");
  if (!keys.length) return null;
  return (
    <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
      {keys.map((k) => {
        const b = before?.[k];
        const a = after?.[k];
        return (
          <div key={k} className="contents">
            <dt className="text-ink-muted">{k}</dt>
            <dd className="break-words tabular-nums">
              {before && k in before && after && k in after ? (
                <>
                  <span className="line-through decoration-ink-muted">{fmt(b)}</span> <span aria-hidden="true">→</span>
                  <span className="sr-only">changed to</span> {fmt(a)}
                </>
              ) : (
                fmt(after && k in after ? a : b)
              )}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

export default async function ActivityPage({ searchParams }: { searchParams: Promise<Filters> }) {
  const ctx = await requirePlan();
  const f = await searchParams;
  const page = Math.max(1, Number(f.page) || 1);
  const supabase = await createClient();

  let q = supabase
    .from("activity_log")
    .select("id, org_id, store_id, actor, user_id, entity_type, entity_id, action, before, after, undoable, undone_at, undo_of, created_at")
    .eq("org_id", ctx.org.id);
  const storeIds = new Set(ctx.stores.map((s) => s.id));
  if (f.store && storeIds.has(f.store)) q = q.eq("store_id", f.store);
  if (f.actor && ACTORS.includes(f.actor)) q = q.eq("actor", f.actor);
  if (f.entity && ENTITIES.includes(f.entity)) q = q.eq("entity_type", f.entity);
  if (f.from && /^\d{4}-\d{2}-\d{2}$/.test(f.from)) q = q.gte("created_at", `${f.from}T00:00:00Z`);
  if (f.to && /^\d{4}-\d{2}-\d{2}$/.test(f.to)) q = q.lte("created_at", `${f.to}T23:59:59Z`);
  const { data } = await q.order("created_at", { ascending: false }).range((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const all = (data ?? []) as unknown as (ActivityRow & { created_at: string; user_id: string | null })[];
  const hasMore = all.length > PAGE_SIZE;
  const rows = all.slice(0, PAGE_SIZE);

  // Listing titles for listing entries.
  const listingIds = [...new Set(rows.filter((r) => r.entity_type === "listing" && r.entity_id).map((r) => r.entity_id!))].filter((id) =>
    /^[0-9a-f-]{36}$/i.test(id),
  );
  const titles = new Map<string, string>();
  if (listingIds.length) {
    const { data: ls } = await supabase.from("listings").select("id, title").in("id", listingIds);
    for (const l of ls ?? []) titles.set(l.id as string, l.title as string);
  }
  const storeName = new Map(ctx.stores.map((s) => [s.id, s.label ?? s.ebay_username ?? "Store"]));
  const qs = (p: number) => {
    const params = new URLSearchParams(Object.entries({ ...f, page: String(p) }).filter(([, v]) => v) as [string, string][]);
    return `/app/activity?${params}`;
  };

  return (
    <>
      <PageHeader title="Activity log" description="Everything MarginPilot changed on eBay, by automation or by you. Undo where eBay allows it." />

      <Panel className="mb-6">
        <form method="get" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6 lg:items-end">
          <Select
            id="store"
            label="Store"
            defaultValue={f.store ?? ""}
            options={[{ value: "", label: "All stores" }, ...ctx.stores.map((s) => ({ value: s.id, label: storeName.get(s.id)! }))]}
          />
          <Select
            id="actor"
            label="Who"
            defaultValue={f.actor ?? ""}
            options={[{ value: "", label: "Anyone" }, ...ACTORS.map((a) => ({ value: a, label: a[0].toUpperCase() + a.slice(1) }))]}
          />
          <Select
            id="entity"
            label="What"
            defaultValue={f.entity ?? ""}
            options={[{ value: "", label: "Everything" }, ...ENTITIES.map((e) => ({ value: e, label: e[0].toUpperCase() + e.slice(1) }))]}
          />
          <TextInput id="from" type="date" label="From" defaultValue={f.from ?? ""} />
          <TextInput id="to" type="date" label="To" defaultValue={f.to ?? ""} />
          <div className="flex gap-2">
            <button type="submit" className={buttonClasses("secondary")}>
              Filter
            </button>
            <Link href="/app/activity" className={buttonClasses("ghost")}>
              Reset
            </Link>
          </div>
        </form>
      </Panel>

      {rows.length === 0 ? (
        <EmptyState title="No activity">Changes made by automation and through MarginPilot appear here.</EmptyState>
      ) : (
        <ActionForm action={undoEntry} messageFirst aria-label="Activity entries">
          <ol className="divide-y divide-line rounded-lg border border-line bg-card">
            {rows.map((r) => {
              const blocked = undoBlockReason(r);
              const subject = r.entity_type === "listing" && r.entity_id ? titles.get(r.entity_id) : null;
              return (
                <li key={r.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {ACTION_LABEL[r.action] ?? r.action.replaceAll("_", " ")}
                      {r.undo_of !== null && <span className="ml-2"><Badge tone="accent">Undo</Badge></span>}
                      {r.undone_at && <span className="ml-2"><Badge>Undone</Badge></span>}
                    </p>
                    <p className="text-sm text-ink-muted">
                      {subject ? `${subject} · ` : `${r.entity_type} · `}
                      {r.actor === "automation" ? "Automation" : r.actor === "user" ? "A team member" : "System"}
                      {r.store_id && ctx.stores.length > 1 ? ` · ${storeName.get(r.store_id) ?? "Store"}` : ""} ·{" "}
                      <time dateTime={r.created_at}>
                        {new Date(r.created_at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
                      </time>
                    </p>
                    <Diff before={r.before} after={r.after} />
                  </div>
                  <div className="shrink-0 sm:w-56 sm:text-right">
                    {blocked ? (
                      r.undo_of === null && !r.undone_at ? <p className="text-xs text-ink-muted">{blocked}</p> : null
                    ) : (
                      <SubmitButton name="intent" value={`undo:${r.id}`} variant="secondary" pendingText="Undoing…">
                        Undo
                      </SubmitButton>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </ActionForm>
      )}

      {(page > 1 || hasMore) && (
        <nav aria-label="Pages" className="mt-4 flex justify-between">
          {page > 1 ? (
            <Link href={qs(page - 1)} className={buttonClasses("secondary")}>
              Newer
            </Link>
          ) : (
            <span />
          )}
          {hasMore && (
            <Link href={qs(page + 1)} className={buttonClasses("secondary")}>
              Older
            </Link>
          )}
        </nav>
      )}
    </>
  );
}
