import "server-only";
import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { evaluateFlag, type FlagRow } from "@/lib/admin/flag-rules";

/**
 * Feature flags, managed at /admin/flags.
 *
 *   if (await isFeatureEnabled("bulk_lister.v2", ctx.org.id)) { ... }
 *
 * A flag is on when enabled globally, or when the org is on its allowlist.
 * Unknown keys are off. All flags are read once per request (React cache());
 * in background jobs (no request) each call reads afresh.
 */
const loadFlags = cache(async (): Promise<Map<string, FlagRow>> => {
  try {
    const db = createAdminClient();
    const { data, error } = await db.from("feature_flags").select("key, enabled, org_allowlist");
    if (error) throw error;
    return new Map((data as FlagRow[]).map((f) => [f.key, f]));
  } catch (err) {
    // Fail closed: a database hiccup turns flagged features off rather than erroring the page.
    console.error("feature flags unavailable", err);
    return new Map();
  }
});

export async function isFeatureEnabled(key: string, orgId?: string | null): Promise<boolean> {
  const flags = await loadFlags();
  return evaluateFlag(flags.get(key), orgId);
}

/** All flags that are on for an org (e.g. to pass a list to a client component). */
export async function enabledFeatures(orgId?: string | null): Promise<string[]> {
  const flags = await loadFlags();
  return [...flags.values()].filter((f) => evaluateFlag(f, orgId)).map((f) => f.key);
}
