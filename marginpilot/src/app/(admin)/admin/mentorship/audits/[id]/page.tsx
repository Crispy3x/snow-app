import Link from "next/link";
import { notFound } from "next/navigation";
import { adminContext, formatDateTime, userEmails } from "@/lib/admin/server";
import { Alert, PageHeader, Panel, StatCard, money } from "@/components/ui/app";
import { buttonClasses } from "@/components/ui/button";
import { Badge } from "@/components/ui/layout";
import { FeedbackForm } from "@/components/mentorship/admin-forms";
import { weekLabel } from "@/lib/mentorship/iso-week";
import { storeSnapshot } from "@/lib/mentorship/server";
import type { AuditStatus } from "@/lib/mentorship/validation";
import { startReview } from "../../actions";

export const metadata = { title: "Store audit" };

type Req = {
  id: string;
  org_id: string;
  store_id: string;
  requested_by: string | null;
  week_of: string;
  seller_notes: string | null;
  status: AuditStatus;
  feedback: string | null;
  feedback_draft: string | null;
  delivered_at: string | null;
  delivered_by: string | null;
  created_at: string;
  organizations: { name: string; plan: string } | null;
  ebay_stores: { label: string | null; ebay_username: string | null; marketplace_id: string; status: string } | null;
};

export default async function AuditRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { db } = await adminContext();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { data } = await db
    .from("store_audit_requests")
    .select(
      "id, org_id, store_id, requested_by, week_of, seller_notes, status, feedback, feedback_draft, delivered_at, delivered_by, created_at, organizations(name, plan), ebay_stores(label, ebay_username, marketplace_id, status)",
    )
    .eq("id", id)
    .maybeSingle();
  if (!data) notFound();
  const r = data as unknown as Req;
  const [snap, emails] = await Promise.all([storeSnapshot(db, r.org_id, r.store_id), userEmails(db, [r.requested_by, r.delivered_by])]);
  const storeName = r.ebay_stores?.label ?? r.ebay_stores?.ebay_username ?? "Store";

  return (
    <>
      <p className="mb-2 text-sm">
        <Link href="/admin/mentorship" className="text-accent underline underline-offset-2">
          Mentorship
        </Link>
      </p>
      <PageHeader
        title={`Audit: ${r.organizations?.name ?? "Workspace"}`}
        description={`${storeName} · ${weekLabel(r.week_of)} · requested ${formatDateTime(r.created_at)}${r.requested_by ? ` by ${emails.get(r.requested_by) ?? "a member"}` : ""}`}
        actions={
          r.status === "requested" ? (
            <form action={startReview}>
              <input type="hidden" name="id" value={r.id} />
              <button type="submit" className={buttonClasses("secondary")}>
                Mark in review
              </button>
            </form>
          ) : (
            <Badge tone={r.status === "delivered" ? "accent" : "neutral"}>{r.status === "delivered" ? "Delivered" : "In review"}</Badge>
          )
        }
      />
      <div className="grid gap-6">
        {r.organizations && r.organizations.plan !== "mentorship" && (
          <Alert tone="warning">This workspace is no longer on the Mentorship plan, so their Mentorship page is locked. Delivered feedback stays stored and reappears if they upgrade again.</Alert>
        )}
        {r.ebay_stores && r.ebay_stores.status !== "active" && (
          <Alert tone="warning">The store&apos;s eBay connection is {r.ebay_stores.status.replace("_", " ")}, so the numbers below may be out of date.</Alert>
        )}

        <section aria-labelledby="snapshot-heading" className="grid gap-3">
          <h2 id="snapshot-heading" className="text-lg font-semibold">
            Store snapshot
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Active listings" value={snap.activeListings.toLocaleString()} />
            <StatCard label="Sales, last 30 days" value={money(snap.sales30)} sub={`${snap.orders30.toLocaleString()} orders · ${snap.metricDays} days of data`} />
            <StatCard label="Net profit, last 30 days" value={money(snap.net30)} />
            <StatCard
              label={`Below ${snap.marginFloor}% margin floor`}
              value={snap.lowMargin.toLocaleString()}
              sub={`Checked at worst-case ad rate and sale discount${snap.unknownMargin ? `; ${snap.unknownMargin} with no cost data` : ""}${snap.checkedListings >= 5000 ? "; first 5,000 listings" : ""}`}
            />
          </div>
        </section>

        <Panel title="Seller's notes">
          {r.seller_notes ? <p className="whitespace-pre-line">{r.seller_notes}</p> : <p className="text-ink-muted">No notes.</p>}
        </Panel>

        {r.status === "delivered" && r.feedback && (
          <Panel
            title="Delivered feedback (what the workspace sees)"
            description={r.delivered_at ? `Delivered ${formatDateTime(r.delivered_at)}${r.delivered_by ? ` by ${emails.get(r.delivered_by) ?? "an admin"}` : ""}` : undefined}
          >
            <p className="whitespace-pre-line text-sm">{r.feedback}</p>
          </Panel>
        )}

        <Panel title={r.status === "delivered" ? "Revise feedback" : "Write feedback"}>
          <FeedbackForm id={r.id} draft={r.feedback_draft ?? r.feedback ?? ""} delivered={r.status === "delivered"} />
        </Panel>
      </div>
    </>
  );
}
