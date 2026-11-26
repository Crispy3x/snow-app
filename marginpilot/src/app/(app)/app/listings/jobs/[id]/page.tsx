import { notFound } from "next/navigation";
import { requirePlan } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { DataTable, PageHeader, StatCard, TextLink, td, th } from "@/components/ui/app";
import { AutoRefresh } from "../../_components/auto-refresh";
import { JobStatusBadge, ListingStatusBadge } from "../../_components/status-badge";

export const metadata = { title: "Batch progress" };

type Item = {
  id: string;
  position: number;
  input: { kind: "link"; ref: string } | { kind: "csv"; row: Record<string, string> };
  status: string;
  error: string | null;
  listing_id: string | null;
  listings: { id: string; title: string; status: string; price: number | string } | null;
};

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePlan();
  const supabase = await createClient();
  const { data: job } = await supabase
    .from("bulk_jobs")
    .select("id, status, total, mode, source, created_at, finished_at, target_margin_pct, suppliers(name)")
    .eq("id", id)
    .eq("org_id", ctx.org.id)
    .maybeSingle();
  if (!job) notFound();
  const { data } = await supabase
    .from("bulk_job_items")
    .select("id, position, input, status, error, listing_id, listings(id, title, status, price)")
    .eq("job_id", id)
    .order("position");
  const items = (data ?? []) as unknown as Item[];
  const done = items.filter((i) => i.status === "done").length;
  const failed = items.filter((i) => i.status === "failed").length;
  const finished = done + failed;
  const active = job.status === "queued" || job.status === "running";
  const supplierName = (job.suppliers as unknown as { name: string } | null)?.name;

  return (
    <>
      <PageHeader
        title="Batch progress"
        description={`${job.total} items from ${supplierName ?? "a supplier"}, ${job.mode === "publish" ? "publishing to eBay" : "saved as drafts"}, target margin ${job.target_margin_pct ?? "store floor"}%.`}
        actions={<AutoRefresh active={active} />}
      />
      <div className="grid gap-6">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Status" value={<JobStatusBadge status={job.status} />} />
          <StatCard label="Processed" value={`${finished} / ${items.length}`} />
          <StatCard label="Succeeded" value={done} />
          <StatCard label="Failed" value={failed} />
        </div>
        <div
          className="h-2 rounded bg-line"
          role="progressbar"
          aria-label="Batch progress"
          aria-valuemin={0}
          aria-valuemax={items.length}
          aria-valuenow={finished}
        >
          <div className="h-2 rounded bg-accent" style={{ width: `${items.length ? (finished / items.length) * 100 : 0}%` }} />
        </div>

        <DataTable caption="Batch items">
          <thead>
            <tr>
              <th className={th} scope="col">#</th>
              <th className={th} scope="col">Input</th>
              <th className={th} scope="col">Status</th>
              <th className={th} scope="col">Listing</th>
              <th className={th} scope="col">Notes</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.id}>
                <td className={`${td} tabular-nums text-ink-muted`}>{i.position + 1}</td>
                <td className={`${td} max-w-[220px] break-all`}>{i.input.kind === "link" ? i.input.ref : `${i.input.row.sku}: ${i.input.row.title}`}</td>
                <td className={td}>
                  <JobStatusBadge status={i.status} />
                </td>
                <td className={td}>
                  {i.listings ? (
                    <div className="grid gap-1">
                      <TextLink href={`/app/listings/${i.listings.id}`}>{i.listings.title}</TextLink>
                      <ListingStatusBadge status={i.listings.status} />
                    </div>
                  ) : (
                    <span className="text-ink-muted">–</span>
                  )}
                </td>
                <td className={`${td} max-w-[280px] text-sm ${i.status === "failed" ? "text-danger" : "text-ink-muted"}`}>{i.error ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </DataTable>
        <p className="text-sm">
          <TextLink href="/app/listings?status=draft">Review drafts</TextLink>
        </p>
      </div>
    </>
  );
}
