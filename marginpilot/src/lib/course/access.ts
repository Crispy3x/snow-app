import "server-only";
import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { courseAccessReason, type AccessReason, type SubscriptionRow } from "./access-rule";

/**
 * Server-side course entitlement for a user (same rule as has_course_access() in SQL).
 * Uses the service role so it also works for team members who can't read
 * the org's subscription rows through RLS; the userId must come from the session.
 */
export const getCourseAccessReason = cache(async (userId: string): Promise<AccessReason> => {
  const db = createAdminClient();
  const [purchases, memberships] = await Promise.all([
    db.from("course_purchases").select("refunded_at").eq("user_id", userId),
    db.from("memberships").select("org_id").eq("user_id", userId),
  ]);
  const orgIds = (memberships.data ?? []).map((m) => m.org_id as string);
  let subscriptions: SubscriptionRow[] = [];
  if (orgIds.length > 0) {
    const { data } = await db.from("subscriptions").select("plan, status").in("org_id", orgIds);
    subscriptions = (data ?? []) as SubscriptionRow[];
  }
  return courseAccessReason((purchases.data ?? []) as { refunded_at: string | null }[], subscriptions);
});

export async function hasCourseAccess(userId: string): Promise<boolean> {
  return (await getCourseAccessReason(userId)) !== null;
}
