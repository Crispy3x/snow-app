/**
 * Commission rules. Pure functions, unit tested.
 *
 * Commission = REFERRAL_COMMISSION_PCT (default 30) of the referred
 * workspace's first paid invoice, recorded as pending. An admin approves it
 * and marks it paid by hand. A refund of that payment within
 * REFUND_WINDOW_DAYS voids it.
 */

export const DEFAULT_COMMISSION_PCT = 30;
export const REFUND_WINDOW_DAYS = 30;

export type ReferralStatus = "signed_up" | "converted" | "paid" | "void";
export type CommissionStatus = "pending" | "approved" | "paid" | "void";

export function commissionPctFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.REFERRAL_COMMISSION_PCT?.trim();
  if (!raw) return DEFAULT_COMMISSION_PCT;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_COMMISSION_PCT;
  return Math.min(n, 100);
}

/** Whole cents, rounded half up. Never negative. */
export function commissionCents(amountPaidCents: number, pct: number): number {
  if (!(amountPaidCents > 0) || !(pct > 0)) return 0;
  return Math.round((amountPaidCents * pct) / 100);
}

export function withinRefundWindow(firstPaidAt: string | null | undefined, now: Date, days = REFUND_WINDOW_DAYS): boolean {
  if (!firstPaidAt) return false;
  const paid = Date.parse(firstPaidAt);
  if (Number.isNaN(paid)) return false;
  return now.getTime() - paid <= days * 24 * 60 * 60 * 1000;
}

/** Lower-case, and for the local part drop "+tag" (and dots for Gmail) so aliases match. */
export function normalizeEmail(email: string | null | undefined): string | null {
  const e = (email ?? "").trim().toLowerCase();
  const at = e.lastIndexOf("@");
  if (at < 1) return null;
  let local = e.slice(0, at).split("+")[0];
  let domain = e.slice(at + 1);
  if (domain === "googlemail.com") domain = "gmail.com";
  if (domain === "gmail.com") local = local.replace(/\./g, "");
  return local ? `${local}@${domain}` : null;
}

export function isSelfReferral(input: {
  referrerUserId: string;
  referredUserId: string;
  referrerEmail?: string | null;
  referredEmail?: string | null;
}): boolean {
  if (input.referrerUserId === input.referredUserId) return true;
  const a = normalizeEmail(input.referrerEmail);
  const b = normalizeEmail(input.referredEmail);
  return !!a && a === b;
}

export type CommissionOp = "approve" | "void" | "paid";

/**
 * Admin transitions: pending -> approved -> paid, and pending/approved -> void.
 * Returns the new statuses, or null when the change isn't allowed.
 */
export function nextCommissionState(
  current: { status: ReferralStatus; commission_status: CommissionStatus | null },
  op: CommissionOp,
): { status: ReferralStatus; commission_status: CommissionStatus } | null {
  const c = current.commission_status;
  if (current.status === "signed_up" || c === null) {
    // Nothing earned yet; an admin may still void a sign-up (e.g. fraud).
    return op === "void" ? { status: "void", commission_status: "void" } : null;
  }
  switch (op) {
    case "approve":
      return c === "pending" && current.status === "converted" ? { status: "converted", commission_status: "approved" } : null;
    case "paid":
      return c === "approved" ? { status: "paid", commission_status: "paid" } : null;
    case "void":
      return c === "pending" || c === "approved" ? { status: "void", commission_status: "void" } : null;
  }
}

export function formatCents(cents: number, currency = "usd"): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: currency.toUpperCase() });
}
