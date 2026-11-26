import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getPlan, type Plan, type PlanKey } from "@/config/plans";

/**
 * Data access layer for the signed-in user. Every server page, action and
 * route handler gets the user from here, never from client input.
 * Wrapped in React cache() so one request reads the session once.
 */

export type SessionUser = { id: string; email: string; fullName: string | null; isAdmin: boolean };

export type StoreSummary = {
  id: string;
  label: string | null;
  ebay_username: string | null;
  marketplace_id: string;
  status: "active" | "needs_reauth" | "disconnected";
};

export type AppContext = {
  user: SessionUser;
  org: { id: string; name: string; plan: PlanKey | "none"; aiCreditsOverride: number | null };
  role: "owner" | "admin" | "member";
  plan: Plan | null;
  stores: StoreSummary[];
  store: StoreSummary | null;
  onboarding: { connected_ebay?: boolean; set_rules?: boolean; first_batch?: boolean };
};

export const getUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, is_admin")
    .eq("id", user.id)
    .maybeSingle();
  return {
    id: user.id,
    email: user.email ?? "",
    fullName: profile?.full_name ?? null,
    isAdmin: profile?.is_admin ?? false,
  };
});

export async function requireUser(next?: string): Promise<SessionUser> {
  const user = await getUser();
  if (!user) redirect(next ? `/login?next=${encodeURIComponent(next)}` : "/login");
  return user;
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser("/admin");
  if (!user.isAdmin) redirect("/app");
  return user;
}

/** Org, plan, role and the store chosen in the store switcher. */
export const getAppContext = cache(async (): Promise<AppContext> => {
  const user = await requireUser("/app");
  const supabase = await createClient();

  const { data: profile } = await supabase
    .from("profiles")
    .select("current_org_id, current_store_id, onboarding")
    .eq("id", user.id)
    .single();

  const { data: memberships } = await supabase
    .from("memberships")
    .select("role, org_id, organizations(id, name, plan, ai_credits_override)")
    .eq("user_id", user.id);

  type MembershipRow = {
    role: AppContext["role"];
    org_id: string;
    organizations: { id: string; name: string; plan: AppContext["org"]["plan"]; ai_credits_override: number | null } | null;
  };
  const rows = (memberships ?? []) as unknown as MembershipRow[];
  const current = rows.find((m) => m.org_id === profile?.current_org_id) ?? rows[0];
  if (!current?.organizations) redirect("/login?error=no_workspace");

  const o = current.organizations;
  const { data: stores } = await supabase
    .from("ebay_stores")
    .select("id, label, ebay_username, marketplace_id, status")
    .eq("org_id", o.id)
    .order("connected_at");

  const storeList = (stores ?? []) as StoreSummary[];
  const store = storeList.find((s) => s.id === profile?.current_store_id) ?? storeList[0] ?? null;

  return {
    user,
    org: { id: o.id, name: o.name, plan: o.plan, aiCreditsOverride: o.ai_credits_override },
    role: current.role,
    plan: o.plan === "none" ? null : (getPlan(o.plan) ?? null),
    stores: storeList,
    store,
    onboarding: (profile?.onboarding as AppContext["onboarding"]) ?? {},
  };
});

/** Use inside pages that need an active subscription. */
export async function requirePlan(): Promise<AppContext & { plan: Plan }> {
  const ctx = await getAppContext();
  if (!ctx.plan) redirect("/app/billing?reason=no_plan");
  return ctx as AppContext & { plan: Plan };
}

/** Use inside pages that need a connected store selected. */
export async function requireStore(): Promise<AppContext & { plan: Plan; store: StoreSummary }> {
  const ctx = await requirePlan();
  if (!ctx.store) redirect("/app/stores?reason=no_store");
  return ctx as AppContext & { plan: Plan; store: StoreSummary };
}

export function canManage(role: AppContext["role"]) {
  return role === "owner" || role === "admin";
}
