import { z } from "zod";

/** Validation for mentorship sessions, resources, audit requests and feedback. Pure, unit tested. */

export const SESSION_STATUSES = ["scheduled", "done", "cancelled"] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];
export const AUDIT_STATUSES = ["requested", "in_review", "delivered"] as const;
export type AuditStatus = (typeof AUDIT_STATUSES)[number];

export function fieldErrorsFrom(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) out[String(issue.path[0] ?? "form")] ??= issue.message;
  return out;
}

/** Optional https URL; "" -> null. */
const optionalHttpsUrl = (label: string) =>
  z
    .string()
    .trim()
    .max(1000, `Keep the ${label} under 1,000 characters.`)
    .transform((v, ctx) => {
      if (!v) return null;
      try {
        const u = new URL(v);
        if (u.protocol !== "https:") throw new Error();
        return u.toString();
      } catch {
        ctx.addIssue({ code: "custom", message: `Enter the full ${label}, starting with https://.` });
        return z.NEVER;
      }
    });

/**
 * starts_at comes from <input type="datetime-local"> plus the admin's browser
 * offset in minutes (Date.getTimezoneOffset()), so the stored time is exact UTC.
 */
export function localDateTimeToIso(local: string, offsetMinutes: number): string | null {
  const m = local.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!m) return null;
  const utc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) + offsetMinutes * 60_000;
  if (Number.isNaN(utc)) return null;
  return new Date(utc).toISOString();
}

/** Inverse of localDateTimeToIso for prefilling the edit form. */
export function isoToLocalDateTime(iso: string, offsetMinutes: number): string {
  const d = new Date(Date.parse(iso) - offsetMinutes * 60_000);
  return d.toISOString().slice(0, 16);
}

export const sessionSchema = z
  .object({
    title: z.string().trim().min(2, "Enter a title.").max(200, "Keep the title under 200 characters."),
    description: z.string().trim().max(4000, "Keep the description under 4,000 characters."),
    starts_local: z.string().trim().min(1, "Choose the date and time."),
    tz_offset: z.coerce.number().int().min(-840).max(840).catch(0),
    duration_min: z.coerce.number({ message: "Enter the length in minutes." }).int("Use whole minutes.").min(5, "At least 5 minutes.").max(480, "At most 8 hours."),
    join_url: optionalHttpsUrl("join link"),
    recording_url: optionalHttpsUrl("recording link"),
    status: z.enum(SESSION_STATUSES),
  })
  .transform((v, ctx) => {
    const starts_at = localDateTimeToIso(v.starts_local, v.tz_offset);
    if (!starts_at) {
      ctx.addIssue({ code: "custom", path: ["starts_local"], message: "Choose a valid date and time." });
      return z.NEVER;
    }
    return {
      title: v.title,
      description: v.description || null,
      starts_at,
      duration_min: v.duration_min,
      join_url: v.join_url,
      recording_url: v.recording_url,
      status: v.status,
    };
  });

export const resourceLinkSchema = z.object({
  title: z.string().trim().min(2, "Enter a title.").max(200, "Keep the title under 200 characters."),
  description: z.string().trim().max(2000, "Keep the description under 2,000 characters.").transform((v) => v || null),
  url: optionalHttpsUrl("link").refine((v) => v !== null, "Enter the link, starting with https://."),
});

export const auditRequestSchema = z.object({
  store_id: z.uuid("Choose a store."),
  seller_notes: z.string().trim().max(4000, "Keep your notes under 4,000 characters.").transform((v) => v || null),
});

export const feedbackSchema = z.object({
  id: z.uuid(),
  feedback: z.string().trim().max(20000, "Keep the feedback under 20,000 characters."),
  intent: z.enum(["save", "deliver"]),
}).superRefine((v, ctx) => {
  if (v.intent === "deliver" && v.feedback.length < 20) {
    ctx.addIssue({ code: "custom", path: ["feedback"], message: "Write the feedback (at least a few sentences) before delivering it." });
  }
});
