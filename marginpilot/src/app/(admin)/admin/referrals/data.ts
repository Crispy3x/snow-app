import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CommissionStatus, ReferralStatus } from "@/lib/referrals/commission";

export type AdminReferral = {
  id: string;
  code: string;
  referrer_user_id: string | null;
  referred_user_id: string | null;
  referred_org_id: string | null;
  referred_label: string;
  status: ReferralStatus;
  first_paid_at: string | null;
  first_invoice_id: string | null;
  first_invoice_amount_cents: number | null;
  currency: string;
  commission_pct: number | string | null;
  commission_cents: number;
  commission_status: CommissionStatus | null;
  commission_paid_at: string | null;
  notes: string | null;
  created_at: string;
};

export const FILTERS = ["all", "signed_up", "pending", "approved", "paid", "void"] as const;
export type Filter = (typeof FILTERS)[number];

export async function loadReferrals(db: SupabaseClient, filter: Filter, limit = 1000): Promise<{ rows: AdminReferral[]; error: string | null }> {
  let q = db
    .from("referrals")
    .select(
      "id, code, referrer_user_id, referred_user_id, referred_org_id, referred_label, status, first_paid_at, first_invoice_id, first_invoice_amount_cents, currency, commission_pct, commission_cents, commission_status, commission_paid_at, notes, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(limit);
  if (filter === "signed_up") q = q.eq("status", "signed_up");
  else if (filter === "void") q = q.eq("status", "void");
  else if (filter !== "all") q = q.eq("commission_status", filter);
  const { data, error } = await q;
  return { rows: (data ?? []) as AdminReferral[], error: error?.message ?? null };
}

export type ReferrerTotals = { userId: string; signups: number; converted: number; pending: number; approved: number; paid: number };

/** Sign-ups, conversions and commission cents per referrer, most owed first. */
export function totalsByReferrer(rows: AdminReferral[]): ReferrerTotals[] {
  const map = new Map<string, ReferrerTotals>();
  for (const r of rows) {
    const id = r.referrer_user_id ?? "(deleted user)";
    const t = map.get(id) ?? { userId: id, signups: 0, converted: 0, pending: 0, approved: 0, paid: 0 };
    t.signups += 1;
    if (r.status === "converted" || r.status === "paid") t.converted += 1;
    if (r.commission_status === "pending") t.pending += r.commission_cents;
    if (r.commission_status === "approved") t.approved += r.commission_cents;
    if (r.commission_status === "paid") t.paid += r.commission_cents;
    map.set(id, t);
  }
  return [...map.values()].sort((a, b) => b.approved + b.pending - (a.approved + a.pending) || b.signups - a.signups);
}
