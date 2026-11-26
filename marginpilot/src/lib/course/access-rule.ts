import { getPlan } from "@/config/plans";

/**
 * Pure course-access rule, mirroring has_course_access() in 0001_init.sql:
 * an unrefunded course purchase, OR membership in an org whose subscription is
 * active/trialing on a plan that includes the course (Professional, Mentorship).
 */

export type PurchaseRow = { refunded_at: string | null };
export type SubscriptionRow = { plan: string; status: string };

export const ACCESS_STATUSES = new Set(["active", "trialing"]);

export function planIncludesCourse(plan: string): boolean {
  return getPlan(plan)?.limits.course ?? false;
}

export type AccessReason = "purchase" | "plan" | null;

export function courseAccessReason(purchases: readonly PurchaseRow[], subscriptions: readonly SubscriptionRow[]): AccessReason {
  if (purchases.some((p) => p.refunded_at === null)) return "purchase";
  if (subscriptions.some((s) => ACCESS_STATUSES.has(s.status) && planIncludesCourse(s.plan))) return "plan";
  return null;
}

export function courseAccessFromRows(purchases: readonly PurchaseRow[], subscriptions: readonly SubscriptionRow[]): boolean {
  return courseAccessReason(purchases, subscriptions) !== null;
}

/** Whether a given lesson's video, body and resources may be shown. */
export function canViewLesson(lesson: { is_published: boolean; is_preview: boolean }, hasAccess: boolean, isAdmin = false): boolean {
  if (isAdmin) return true;
  return lesson.is_published && (hasAccess || lesson.is_preview);
}
