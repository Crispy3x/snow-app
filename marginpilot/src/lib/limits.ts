import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPlan, type PlanKey } from "@/config/plans";

export type LimitKey = "stores" | "listings" | "seats";

export class PlanLimitError extends Error {
  constructor(
    public limit: LimitKey | "ai_credits" | "no_plan",
    message: string,
  ) {
    super(message);
    this.name = "PlanLimitError";
  }
}

async function orgPlan(orgId: string) {
  const db = createAdminClient();
  const { data } = await db.from("organizations").select("plan, ai_credits_override").eq("id", orgId).single();
  const plan = data && data.plan !== "none" ? getPlan(data.plan as PlanKey) : undefined;
  return { plan, override: (data?.ai_credits_override as number | null) ?? null };
}

export async function usage(orgId: string): Promise<Record<LimitKey, number>> {
  const db = createAdminClient();
  const [stores, listings, seats] = await Promise.all([
    db.from("ebay_stores").select("id", { count: "exact", head: true }).eq("org_id", orgId).neq("status", "disconnected"),
    db
      .from("listings")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .in("status", ["draft", "queued", "publishing", "active", "out_of_stock", "blocked_margin"]),
    db.from("memberships").select("user_id", { count: "exact", head: true }).eq("org_id", orgId),
  ]);
  return { stores: stores.count ?? 0, listings: listings.count ?? 0, seats: seats.count ?? 0 };
}

/** Throws PlanLimitError if adding `adding` more of `key` would exceed the plan. */
export async function assertWithinLimit(orgId: string, key: LimitKey, adding = 1): Promise<void> {
  const { plan } = await orgPlan(orgId);
  if (!plan) throw new PlanLimitError("no_plan", "Choose a plan to use this feature.");
  const used = (await usage(orgId))[key];
  const max = plan.limits[key];
  if (used + adding > max) {
    const names = { stores: "eBay stores", listings: "active listings", seats: "team seats" };
    throw new PlanLimitError(
      key,
      `Your ${plan.name} plan allows ${max.toLocaleString()} ${names[key]} and you're using ${used.toLocaleString()}. Upgrade to add more.`,
    );
  }
}

/** First day of the current UTC month, as YYYY-MM-DD. Credits reset monthly. */
export function creditPeriodStart(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
}

export async function aiCreditBalance(orgId: string): Promise<{ allowance: number; used: number; remaining: number }> {
  const { plan, override } = await orgPlan(orgId);
  const allowance = (plan?.limits.aiCreditsPerMonth ?? 0) + (override ?? 0);
  const db = createAdminClient();
  const { data } = await db
    .from("ai_credit_ledger")
    .select("delta")
    .eq("org_id", orgId)
    .eq("period_start", creditPeriodStart());
  const net = (data ?? []).reduce((s, r) => s + (r.delta as number), 0); // spends are negative, grants positive
  const used = Math.max(0, -net);
  return { allowance, used, remaining: allowance + net };
}

export async function orgHasFeature(orgId: string, feature: "course" | "mentorship"): Promise<boolean> {
  const { plan } = await orgPlan(orgId);
  return !!plan?.limits[feature];
}
