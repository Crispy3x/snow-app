/** Pure feature-flag logic, shared by src/lib/flags.ts and the admin flags page. */

export type FlagRow = { key: string; enabled: boolean; org_allowlist: string[] | null };

/** Keys like "bulk_lister.v2" or "new-dashboard": lowercase, start with a letter. */
export const FLAG_KEY_PATTERN = /^[a-z][a-z0-9_.-]{1,62}$/;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A flag is on for an org when it is enabled for everyone, or when the org is
 * on its allowlist (lets you trial a feature with chosen orgs while it's off
 * globally). Unknown flags are off.
 */
export function evaluateFlag(flag: FlagRow | undefined, orgId?: string | null): boolean {
  if (!flag) return false;
  if (flag.enabled) return true;
  return !!orgId && (flag.org_allowlist ?? []).includes(orgId);
}

/** Parse an allowlist typed as UUIDs separated by commas, spaces or new lines. */
export function parseAllowlist(text: string): { ids: string[]; invalid: string[] } {
  const parts = text
    .split(/[\s,]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const ids: string[] = [];
  const invalid: string[] = [];
  for (const p of parts) {
    if (!UUID.test(p)) invalid.push(p);
    else if (!ids.includes(p)) ids.push(p);
  }
  return { ids, invalid };
}

export function isUuid(s: string): boolean {
  return UUID.test(s);
}
