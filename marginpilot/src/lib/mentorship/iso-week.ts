/**
 * ISO-8601 weeks (Monday to Sunday, UTC) for the weekly store audit.
 * A workspace may request one audit per ISO week; store_audit_requests.week_of
 * holds the Monday and has a unique (org_id, week_of) constraint. Pure, unit tested.
 */

const DAY = 86_400_000;

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Monday (YYYY-MM-DD, UTC) of the ISO week containing `date`. */
export function isoWeekStart(date: Date): string {
  const utc = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const dow = (new Date(utc).getUTCDay() + 6) % 7; // Monday = 0
  return ymd(new Date(utc - dow * DAY));
}

/** ISO year and week number, e.g. { year: 2026, week: 48 }. */
export function isoWeek(date: Date): { year: number; week: number } {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow + 3); // Thursday of this week decides the year
  const year = d.getUTCFullYear();
  const week = Math.ceil(((d.getTime() - Date.UTC(year, 0, 1)) / DAY + 1) / 7);
  return { year, week };
}

/** "Week 48 (Nov 23 – Nov 29, 2026)" for a Monday date string. */
export function weekLabel(weekOf: string): string {
  const start = new Date(`${weekOf}T00:00:00Z`);
  const end = new Date(start.getTime() + 6 * DAY);
  const fmt = (d: Date, year: boolean) =>
    d.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(year ? { year: "numeric" } : {}), timeZone: "UTC" });
  return `Week ${isoWeek(start).week} (${fmt(start, false)} – ${fmt(end, true)})`;
}

export type AuditRequestLike = { week_of: string };

/**
 * Whether the workspace can request an audit in the week containing `now`.
 * Returns the week it would be filed under, and the existing request if there is one.
 */
export function auditRequestWindow<T extends AuditRequestLike>(existing: T[], now: Date): { allowed: boolean; weekOf: string; current: T | null; nextWeekOf: string } {
  const weekOf = isoWeekStart(now);
  const current = existing.find((r) => r.week_of === weekOf) ?? null;
  const nextWeekOf = ymd(new Date(Date.parse(`${weekOf}T00:00:00Z`) + 7 * DAY));
  return { allowed: current === null, weekOf, current, nextWeekOf };
}
