import Link from "next/link";
import { Alert, EmptyState, PageHeader, Panel } from "@/components/ui/app";
import { adminContext, formatDate } from "@/lib/admin/server";
import { publicProofUrl } from "@/lib/proof";
import { todayIso } from "@/lib/proof-admin/rules";
import { BUCKETS, signedUrls } from "@/lib/proof-admin/storage";
import { ActionButton, MoveButtons, ProofTabs, StatusBadge, pendingCounts } from "./proof-ui";
import { deleteScreenshot, moveScreenshot, rejectScreenshot, unpublishScreenshot } from "./actions";
import { UploadScreenshotForm } from "./upload-form";

export const metadata = { title: "Proof queue" };

type Row = {
  id: string;
  original_path: string;
  public_image_path: string | null;
  redactions: unknown[];
  caption: string;
  store_label: string;
  range_start: string;
  range_end: string;
  captured_on: string;
  status: "pending" | "approved" | "rejected";
  sort_order: number;
};

const GROUPS = [
  { status: "pending", title: "Waiting for redaction and review", empty: "Nothing waiting. Upload a screenshot to start." },
  { status: "approved", title: "Published", empty: "Nothing published. The Results section stays hidden until something is approved." },
  { status: "rejected", title: "Rejected", empty: "No rejected screenshots." },
] as const;

export default async function ProofScreenshotsPage() {
  const { db } = await adminContext();
  const [{ data, error }, pending] = await Promise.all([
    db
      .from("proof_screenshots")
      .select("id, original_path, public_image_path, redactions, caption, store_label, range_start, range_end, captured_on, status, sort_order")
      .order("sort_order", { ascending: true })
      .order("captured_on", { ascending: false })
      .limit(500),
    pendingCounts(db),
  ]);
  const rows = (data ?? []) as Row[];
  const originals = await signedUrls(db, BUCKETS.originals, rows.filter((r) => r.status !== "approved").map((r) => r.original_path), 600);

  return (
    <>
      <PageHeader
        title="Proof queue"
        description="Real Seller Hub screenshots only. Each is stored privately, redacted here, and published as a pixelated copy only after you approve it."
      />
      <ProofTabs current="screenshots" pending={pending} />
      {error && (
        <div className="mb-4">
          <Alert tone="danger" title="Couldn't load screenshots">{error.message}</Alert>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-8">
          {GROUPS.map((g) => {
            const items = rows.filter((r) => r.status === g.status);
            return (
              <section key={g.status} aria-labelledby={`sg-${g.status}`}>
                <h2 id={`sg-${g.status}`} className="mb-3 text-lg font-semibold">
                  {g.title} <span className="text-ink-muted">({items.length})</span>
                </h2>
                {items.length === 0 ? (
                  <EmptyState title="None">{g.empty}</EmptyState>
                ) : (
                  <ul className="space-y-4">
                    {items.map((s, i) => {
                      const thumb = s.public_image_path ? publicProofUrl(s.public_image_path) : originals.get(s.original_path);
                      return (
                        <li key={s.id} className="flex flex-col gap-4 rounded-lg border border-line bg-card p-4 sm:flex-row">
                          {thumb && (
                            // eslint-disable-next-line @next/next/no-img-element -- signed or public storage URL
                            <img
                              src={thumb}
                              alt={s.public_image_path ? `Published, redacted screenshot: ${s.caption}` : `Original upload (not public): ${s.caption}`}
                              className="h-32 w-full shrink-0 rounded border border-line object-cover object-top sm:w-48"
                              loading="lazy"
                            />
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <StatusBadge status={s.status} />
                              <span className="text-xs text-ink-muted">
                                {s.redactions?.length ?? 0} redaction box{s.redactions?.length === 1 ? "" : "es"}
                              </span>
                            </div>
                            <p className="mt-2 font-medium break-words">{s.caption}</p>
                            <p className="text-sm text-ink-muted">
                              {s.store_label} · {formatDate(s.range_start)} to {formatDate(s.range_end)} · captured {formatDate(s.captured_on)}
                            </p>
                            <div className="mt-3 flex flex-wrap items-center gap-2">
                              <Link
                                href={`/admin/proof/screenshots/${s.id}`}
                                className="inline-flex min-h-10 items-center rounded-md bg-accent px-4 text-sm font-semibold text-white hover:bg-accent-strong"
                              >
                                {s.status === "pending" ? "Redact and review" : "Open"}
                                <span className="sr-only">: {s.caption}</span>
                              </Link>
                              {s.status === "approved" && <ActionButton id={s.id} action={unpublishScreenshot}>Unpublish</ActionButton>}
                              {s.status === "pending" && <ActionButton id={s.id} action={rejectScreenshot} danger>Reject</ActionButton>}
                              {s.status === "rejected" && <ActionButton id={s.id} action={deleteScreenshot} danger>Delete permanently</ActionButton>}
                              <div className="ml-auto">
                                <MoveButtons id={s.id} label={`screenshot ${s.caption}`} action={moveScreenshot} first={i === 0} last={i === items.length - 1} />
                              </div>
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            );
          })}
        </div>

        <Panel title="Upload a screenshot" description="Every screenshot needs a caption, the date range it shows and the date it was captured.">
          <UploadScreenshotForm today={todayIso()} />
        </Panel>
      </div>
    </>
  );
}
