import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { commissionCents, commissionPctFromEnv, REFUND_WINDOW_DAYS, withinRefundWindow, type CommissionStatus, type ReferralStatus } from "./commission";

/**
 * Referral side of the Stripe webhook (called from src/lib/billing/webhook.ts).
 * Every write is a conditional update, so duplicate or re-ordered deliveries
 * (invoice.paid and invoice.payment_succeeded both arrive) apply once.
 */

export type ReferralWebhookDeps = { db: SupabaseClient; now?: () => Date; commissionPct?: number };

type Expandable = string | { id: string } | null | undefined;
type Metadata = Record<string, string> | null | undefined;

export type ReferralInvoice = {
  id: string;
  customer: Expandable;
  amount_paid?: number | null;
  currency?: string | null;
  status_transitions?: { paid_at?: number | null } | null;
  payment_intent?: Expandable; // older API versions
  payments?: { data?: Array<{ payment?: { payment_intent?: Expandable; charge?: Expandable } | null }> } | null;
  subscription_details?: { metadata?: Metadata } | null; // older API versions
  parent?: { subscription_details?: { metadata?: Metadata } | null } | null;
};

export type ReferralCharge = {
  id: string;
  customer?: Expandable;
  payment_intent: Expandable;
  refunded: boolean;
  amount?: number;
  amount_refunded?: number;
  currency?: string | null;
};

type ReferralRow = {
  id: string;
  status: ReferralStatus;
  commission_status: CommissionStatus | null;
  referred_org_id: string | null;
  first_paid_at: string | null;
  notes: string | null;
};

const COLS = "id, status, commission_status, referred_org_id, first_paid_at, notes";
const idOf = (v: Expandable): string | null => (v == null ? null : typeof v === "string" ? v : v.id);

function check<T extends { error: { message: string } | null }>(res: T, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res;
}

async function orgForCustomer(db: SupabaseClient, customer: Expandable): Promise<string | null> {
  const id = idOf(customer);
  if (!id) return null;
  const { data } = await db.from("organizations").select("id").eq("stripe_customer_id", id).maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

function paymentIntentOf(invoice: ReferralInvoice): string | null {
  return idOf(invoice.payment_intent) ?? idOf(invoice.payments?.data?.find((p) => p.payment?.payment_intent)?.payment?.payment_intent) ?? null;
}

/** invoice.paid / invoice.payment_succeeded: the first paid invoice converts the referral. */
export async function recordReferralConversion(invoice: ReferralInvoice, deps: ReferralWebhookDeps): Promise<boolean> {
  const amount = invoice.amount_paid ?? 0;
  if (!(amount > 0)) return false; // $0 trial invoices don't count
  const { db } = deps;
  const meta = invoice.parent?.subscription_details?.metadata ?? invoice.subscription_details?.metadata ?? {};
  const orgId = meta.org_id || (await orgForCustomer(db, invoice.customer));

  let row: ReferralRow | null = null;
  if (orgId) {
    const { data } = await db.from("referrals").select(COLS).eq("referred_org_id", orgId).limit(1).maybeSingle();
    row = data as ReferralRow | null;
  }
  if (!row && meta.user_id && meta.referral_code) {
    const { data } = await db.from("referrals").select(COLS).eq("referred_user_id", meta.user_id).limit(1).maybeSingle();
    row = data as ReferralRow | null;
  }
  if (!row || row.status !== "signed_up") return false; // no referral, or already converted/voided

  const now = deps.now ? deps.now() : new Date();
  const pct = deps.commissionPct ?? commissionPctFromEnv();
  const paidAt = invoice.status_transitions?.paid_at ? new Date(invoice.status_transitions.paid_at * 1000) : now;
  check(
    await db
      .from("referrals")
      .update({
        status: "converted",
        referred_org_id: row.referred_org_id ?? orgId ?? null,
        first_paid_at: paidAt.toISOString(),
        first_invoice_id: invoice.id,
        first_payment_intent_id: paymentIntentOf(invoice),
        first_invoice_amount_cents: amount,
        currency: invoice.currency ?? "usd",
        commission_pct: pct,
        commission_cents: commissionCents(amount, pct),
        commission_status: "pending",
        updated_at: now.toISOString(),
      })
      .eq("id", row.id)
      .eq("status", "signed_up"),
    "convert referral",
  );
  return true;
}

function appendNote(notes: string | null, line: string): string {
  return notes ? `${notes}\n${line}` : line;
}

/**
 * charge.refunded: a full refund of the referred workspace's payment within
 * the refund window voids the commission. A commission already paid out
 * stays "paid" with a note so the admin can recover it; partial refunds only add a note.
 */
export async function voidReferralOnRefund(charge: ReferralCharge, deps: ReferralWebhookDeps): Promise<boolean> {
  if (!charge.refunded && !(charge.amount_refunded && charge.amount_refunded > 0)) return false;
  const { db } = deps;
  const now = deps.now ? deps.now() : new Date();

  let row: ReferralRow | null = null;
  const pi = idOf(charge.payment_intent);
  if (pi) {
    const { data } = await db.from("referrals").select(COLS).eq("first_payment_intent_id", pi).limit(1).maybeSingle();
    row = data as ReferralRow | null;
  }
  if (!row) {
    // Newer Stripe API versions may not include the payment intent on the invoice: fall back to the customer.
    const orgId = await orgForCustomer(db, charge.customer);
    if (orgId) {
      const { data } = await db.from("referrals").select(COLS).eq("referred_org_id", orgId).limit(1).maybeSingle();
      row = data as ReferralRow | null;
    }
  }
  if (!row || (row.status !== "converted" && row.status !== "paid")) return false;
  if (!withinRefundWindow(row.first_paid_at, now)) return false;

  const day = now.toISOString().slice(0, 10);
  const refunded = ((charge.amount_refunded ?? charge.amount ?? 0) / 100).toFixed(2);
  if (!charge.refunded) {
    check(
      await db
        .from("referrals")
        .update({ notes: appendNote(row.notes, `${day}: partial refund of ${refunded} (charge ${charge.id}); review the commission.`), updated_at: now.toISOString() })
        .eq("id", row.id),
      "note partial refund",
    );
    return true;
  }

  const alreadyPaid = row.commission_status === "paid";
  check(
    await db
      .from("referrals")
      .update({
        status: "void",
        commission_status: alreadyPaid ? "paid" : "void",
        notes: appendNote(
          row.notes,
          alreadyPaid
            ? `${day}: refunded ${refunded} (charge ${charge.id}) after the commission was paid; recover it manually.`
            : `${day}: refunded ${refunded} (charge ${charge.id}) within ${REFUND_WINDOW_DAYS} days; commission voided.`,
        ),
        updated_at: now.toISOString(),
      })
      .eq("id", row.id)
      .in("status", ["converted", "paid"]),
    "void referral",
  );
  return true;
}
