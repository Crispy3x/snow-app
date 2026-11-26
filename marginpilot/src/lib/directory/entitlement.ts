import { getPlan } from "@/config/plans";

/**
 * Plan entitlements for the directory and the mentorship hub, read from
 * src/config/plans.ts so the pricing page, the app and these checks agree.
 * The SQL helpers org_has_directory() / org_has_mentorship() in
 * 0010_directory_mentorship.sql mirror the same plan keys.
 */

export function planHasDirectory(plan: string | null | undefined): boolean {
  return !!plan && getPlan(plan)?.limits.supplierDirectory === true;
}

export function planHasMentorship(plan: string | null | undefined): boolean {
  return !!plan && getPlan(plan)?.limits.mentorship === true;
}

/** Cheapest plan that includes a feature, for upgrade copy. */
export function cheapestPlanWith(feature: "supplierDirectory" | "mentorship"): { key: string; name: string } | null {
  const keys = ["starter", "professional", "mentorship"];
  for (const k of keys) {
    const p = getPlan(k);
    if (p?.limits[feature]) return { key: p.key, name: p.name };
  }
  return null;
}
