import { adminContext, audit, userEmails } from "@/lib/admin/server";
import { toCsv } from "@/lib/referrals/csv";
import { FILTERS, loadReferrals, type Filter } from "../data";

/** CSV of referrals for manual payouts and bookkeeping. Admin only. */
export async function GET(request: Request) {
  const { admin, db } = await adminContext();
  const raw = new URL(request.url).searchParams.get("status") ?? "all";
  const filter: Filter = (FILTERS as readonly string[]).includes(raw) ? (raw as Filter) : "all";
  const { rows, error } = await loadReferrals(db, filter, 10000);
  if (error) return new Response(`Couldn't load referrals: ${error}`, { status: 500 });

  // Emails for up to 100 people; the rest are exported by user id.
  const emails = await userEmails(db, rows.flatMap((r) => [r.referrer_user_id, r.referred_user_id]));
  const csv = toCsv([
    [
      "referral_id", "created_at", "code", "referrer_user_id", "referrer_email", "referred_user_id", "referred_email", "referred_org_id",
      "status", "first_paid_at", "first_invoice_id", "first_invoice_amount", "currency", "commission_pct", "commission_amount",
      "commission_status", "commission_paid_at", "notes",
    ],
    ...rows.map((r) => [
      r.id, r.created_at, r.code, r.referrer_user_id, r.referrer_user_id ? (emails.get(r.referrer_user_id) ?? "") : "",
      r.referred_user_id, r.referred_user_id ? (emails.get(r.referred_user_id) ?? "") : "", r.referred_org_id,
      r.status, r.first_paid_at, r.first_invoice_id, r.first_invoice_amount_cents != null ? (r.first_invoice_amount_cents / 100).toFixed(2) : "",
      r.currency, r.commission_pct != null ? Number(r.commission_pct) : "", (r.commission_cents / 100).toFixed(2),
      r.commission_status, r.commission_paid_at, r.notes,
    ]),
  ]);
  await audit(db, admin.id, "referrals_export", { details: { filter, rows: rows.length } });
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="referrals-${filter}-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
