import { normalizeCode } from "./code";

/**
 * Counts one referral-link visit (called from proxy.ts with event.waitUntil,
 * only when the first-touch cookie is newly set, so it counts unique visitors
 * rather than reloads). One RPC call to Postgres; never throws, never blocks
 * the response. The RPC ignores codes that don't exist.
 */
export async function recordReferralClick(
  raw: string,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const code = normalizeCode(raw);
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!code || !url || !key) return;
  try {
    await fetchImpl(`${url.replace(/\/+$/, "")}/rest/v1/rpc/record_referral_click`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_code: code }),
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // Click counts are best effort.
  }
}
