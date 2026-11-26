import Link from "next/link";
import { requireStore } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { DataTable, EmptyState, PageHeader, TextLink, money, pct, td, th } from "@/components/ui/app";
import { Select, TextInput } from "@/components/ui/form";
import { Button, LinkButton, buttonClasses } from "@/components/ui/button";
import { ListingStatusBadge, LISTING_STATUSES } from "./_components/status-badge";

export const metadata = { title: "Listings" };

const PAGE_SIZE = 50;

type Row = {
  id: string;
  title: string;
  sku: string;
  price: number | string;
  status: string;
  net_margin_pct: number | string | null;
  views: number;
  sold: number;
  watchers: number;
  manual_cost: number | string | null;
  vero_risk: string | null;
  supplier_products: { cost: number | string | null; shipping_cost: number | string | null } | null;
};

/** Search text safe for a PostgREST or() filter. */
function cleanQuery(q: string) {
  return q.replace(/[%,()*\\]/g, " ").trim().slice(0, 80);
}

export default async function ListingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireStore();
  const status = typeof sp.status === "string" && LISTING_STATUSES.some((s) => s.value === sp.status) ? sp.status : "";
  const q = typeof sp.q === "string" ? cleanQuery(sp.q) : "";
  const page = Math.max(1, Number(sp.page) || 1);

  const supabase = await createClient();
  let query = supabase
    .from("listings")
    .select("id, title, sku, price, status, net_margin_pct, views, sold, watchers, manual_cost, vero_risk, supplier_products(cost, shipping_cost)", { count: "exact" })
    .eq("store_id", ctx.store.id)
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (status) query = query.eq("status", status);
  if (q) query = query.or(`title.ilike.%${q}%,sku.ilike.%${q}%`);
  const { data, count } = await query;
  const rows = (data ?? []) as unknown as Row[];
  const pages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));
  const qs = (p: number) => `/app/listings?${new URLSearchParams({ ...(status ? { status } : {}), ...(q ? { q } : {}), page: String(p) })}`;

  return (
    <>
      <PageHeader
        title="Listings"
        description="Everything in this store, with net margin after fees at the worst-case ad rate."
        actions={
          <>
            <LinkButton href="/app/listings/suppliers" variant="secondary">
              Suppliers
            </LinkButton>
            <LinkButton href="/app/listings/new">Add products</LinkButton>
          </>
        }
      />
      <form method="get" className="mb-4 grid gap-3 sm:grid-cols-[1fr_200px_auto] sm:items-end" role="search">
        <TextInput id="q" label="Search title or SKU" type="search" defaultValue={q} />
        <Select id="status" label="Status" defaultValue={status} options={[{ value: "", label: "All statuses" }, ...LISTING_STATUSES]} />
        <Button type="submit" variant="secondary">
          Filter
        </Button>
      </form>

      {rows.length === 0 ? (
        <EmptyState title={q || status ? "No listings match" : "No listings yet"} action={!q && !status ? <LinkButton href="/app/listings/new">Add products</LinkButton> : undefined}>
          {q || status ? "Try a different search or status." : "Add products from a wholesale supplier to create your first drafts."}
        </EmptyState>
      ) : (
        <>
          <DataTable caption="Listings">
            <thead>
              <tr>
                <th className={th} scope="col">Title</th>
                <th className={th} scope="col">SKU</th>
                <th className={`${th} text-right`} scope="col">Price</th>
                <th className={`${th} text-right`} scope="col">Cost</th>
                <th className={`${th} text-right`} scope="col">Net margin</th>
                <th className={th} scope="col">Status</th>
                <th className={`${th} text-right`} scope="col">Views</th>
                <th className={`${th} text-right`} scope="col">Sold</th>
                <th className={`${th} text-right`} scope="col">Watchers</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const cost = r.supplier_products?.cost ?? r.manual_cost;
                return (
                  <tr key={r.id}>
                    <td className={`${td} min-w-[220px]`}>
                      <TextLink href={`/app/listings/${r.id}`}>{r.title}</TextLink>
                      {r.vero_risk === "high" && <span className="ml-2 text-xs font-semibold text-danger">Brand warning</span>}
                    </td>
                    <td className={`${td} font-mono text-xs`}>{r.sku}</td>
                    <td className={`${td} text-right tabular-nums`}>{money(r.price)}</td>
                    <td className={`${td} text-right tabular-nums`}>{money(cost)}</td>
                    <td className={`${td} text-right tabular-nums`}>{pct(r.net_margin_pct)}</td>
                    <td className={td}>
                      <ListingStatusBadge status={r.status} />
                    </td>
                    <td className={`${td} text-right tabular-nums`}>{r.views}</td>
                    <td className={`${td} text-right tabular-nums`}>{r.sold}</td>
                    <td className={`${td} text-right tabular-nums`}>{r.watchers}</td>
                  </tr>
                );
              })}
            </tbody>
          </DataTable>
          {pages > 1 && (
            <nav aria-label="Pages" className="mt-4 flex items-center justify-between gap-2 text-sm">
              {page > 1 ? (
                <Link className={buttonClasses("secondary")} href={qs(page - 1)}>
                  Previous
                </Link>
              ) : (
                <span />
              )}
              <span className="text-ink-muted">
                Page {page} of {pages} ({(count ?? 0).toLocaleString()} listings)
              </span>
              {page < pages ? (
                <Link className={buttonClasses("secondary")} href={qs(page + 1)}>
                  Next
                </Link>
              ) : (
                <span />
              )}
            </nav>
          )}
        </>
      )}
    </>
  );
}
