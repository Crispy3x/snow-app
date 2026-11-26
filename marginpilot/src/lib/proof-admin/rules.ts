import { z } from "zod";

/**
 * Validation and approval rules for proof items (screenshots and testimonials).
 * Pure: used by admin actions, the customer submission action and the tests.
 * The database adds its own guards (check constraint on testimonials, RLS).
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(s: unknown): s is string {
  if (typeof s !== "string" || !ISO_DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Today as YYYY-MM-DD in UTC. */
export function todayIso(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Allow one day of slack for time zones ahead of UTC. */
function notInFuture(date: string, today: string): boolean {
  const limit = new Date(`${today}T00:00:00Z`);
  limit.setUTCDate(limit.getUTCDate() + 1);
  return date <= limit.toISOString().slice(0, 10);
}

const isoDate = z.string().trim().refine(isIsoDate, "Enter a valid date.");

export function screenshotMetaSchema(today = todayIso()) {
  return z
    .object({
      caption: z.string().trim().min(3, "Add a caption.").max(200, "Keep the caption under 200 characters."),
      store_label: z.string().trim().min(1, "Add a store label.").max(80, "Keep the store label under 80 characters."),
      range_start: isoDate,
      range_end: isoDate,
      captured_on: isoDate,
    })
    .superRefine((v, ctx) => {
      if (isIsoDate(v.range_start) && isIsoDate(v.range_end) && v.range_end < v.range_start) {
        ctx.addIssue({ code: "custom", path: ["range_end"], message: "The end date must be on or after the start date." });
      }
      if (isIsoDate(v.captured_on) && isIsoDate(v.range_end) && v.captured_on < v.range_end) {
        ctx.addIssue({
          code: "custom",
          path: ["captured_on"],
          message: "The capture date can't be before the end of the period shown.",
        });
      }
      if (isIsoDate(v.captured_on) && !notInFuture(v.captured_on, today)) {
        ctx.addIssue({ code: "custom", path: ["captured_on"], message: "The capture date can't be in the future." });
      }
    });
}

export type ScreenshotMeta = z.infer<ReturnType<typeof screenshotMetaSchema>>;

export function testimonialSchema(today = todayIso()) {
  return z.object({
    name: z.string().trim().min(1, "Add a name.").max(80, "Keep the name under 80 characters."),
    quote: z
      .string()
      .trim()
      .min(10, "The quote needs at least 10 characters.")
      .max(1000, "Keep the quote under 1,000 characters."),
    store_type: z.string().trim().min(1, "Describe the store type.").max(80, "Keep the store type under 80 characters."),
    given_on: isoDate.refine((d) => notInFuture(d, today), "The date can't be in the future."),
    permission_given: z.boolean(),
  });
}

export type TestimonialInput = z.infer<ReturnType<typeof testimonialSchema>>;

/** Customers must give permission to submit at all. */
export function customerTestimonialSchema(today = todayIso()) {
  return testimonialSchema(today).refine((v) => v.permission_given, {
    path: ["permission_given"],
    message: "Tick the permission box to submit. We only show testimonials with your permission.",
  });
}

/** Turn zod issues into the { field: message } map ActionState expects (first message per field). */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

export type RuleResult = { ok: true } | { ok: false; reason: string };

export function canApproveTestimonial(t: {
  permission_given: boolean;
  name?: string | null;
  quote?: string | null;
  store_type?: string | null;
  given_on?: string | null;
}): RuleResult {
  if (!t.permission_given) {
    return { ok: false, reason: "This testimonial can't be approved: the person hasn't given permission to show it." };
  }
  if (!t.name?.trim() || !t.quote?.trim() || !t.store_type?.trim() || !isIsoDate(t.given_on)) {
    return { ok: false, reason: "Name, quote, store type and date are all required before approval." };
  }
  return { ok: true };
}

export function canApproveScreenshot(
  s: {
    caption?: string | null;
    store_label?: string | null;
    range_start?: string | null;
    range_end?: string | null;
    captured_on?: string | null;
    image_width?: number | null;
    image_height?: number | null;
  },
  opts: { piiChecked: boolean; today?: string },
): RuleResult {
  if (!opts.piiChecked) {
    return { ok: false, reason: "Confirm you checked for buyer names, addresses and order numbers." };
  }
  if (!s.image_width || !s.image_height) {
    return { ok: false, reason: "The image size is unknown. Re-upload the screenshot." };
  }
  const parsed = screenshotMetaSchema(opts.today).safeParse({
    caption: s.caption ?? "",
    store_label: s.store_label ?? "",
    range_start: s.range_start ?? "",
    range_end: s.range_end ?? "",
    captured_on: s.captured_on ?? "",
  });
  if (!parsed.success) {
    return { ok: false, reason: `Fix the details first: ${parsed.error.issues[0]?.message ?? "invalid details"}` };
  }
  return { ok: true };
}

export type MoveDirection = "up" | "down" | "top" | "bottom";

/** New order of ids after moving one. Unknown id or no-op moves return the same order. */
export function moveId(ids: string[], id: string, direction: MoveDirection): string[] {
  const i = ids.indexOf(id);
  if (i < 0) return ids.slice();
  const out = ids.slice();
  out.splice(i, 1);
  const target =
    direction === "up" ? Math.max(0, i - 1) : direction === "down" ? Math.min(out.length, i + 1) : direction === "top" ? 0 : out.length;
  out.splice(target, 0, id);
  return out;
}

/** sort_order writes needed to store `orderedIds` (10, 20, 30... leaves room), skipping unchanged rows. */
export function sortOrderUpdates(
  rows: { id: string; sort_order: number }[],
  orderedIds: string[],
): { id: string; sort_order: number }[] {
  const current = new Map(rows.map((r) => [r.id, r.sort_order]));
  const updates: { id: string; sort_order: number }[] = [];
  orderedIds.forEach((id, index) => {
    const next = (index + 1) * 10;
    if (current.has(id) && current.get(id) !== next) updates.push({ id, sort_order: next });
  });
  return updates;
}

/** Storage object names we generate: no traversal, only safe characters. */
export function isSafeObjectPath(path: string, prefix: string): boolean {
  return path.startsWith(prefix) && !path.includes("..") && /^[A-Za-z0-9/_.-]+$/.test(path) && path.length <= 300;
}

export const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export const MAX_SCREENSHOT_BYTES = 15 * 1024 * 1024;
/** Photos are downscaled in the browser before upload; this is the server-side cap. */
export const MAX_PHOTO_BYTES = 900 * 1024;
