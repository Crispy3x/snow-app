import { z } from "zod";
import { isBlockedRetailUrl } from "@/lib/suppliers/types";
import { CONTACT_METHODS, DIRECTORY_STATUSES } from "./types";

/**
 * Validation for directory suppliers entered by an admin. Pure, unit tested.
 * eBay allows drop shipping only from wholesale suppliers (docs/PLAN.md §4), so
 * retail stores and marketplaces are rejected as a website or portal.
 */

export const RETAIL_MESSAGE =
  "That's a retail store or marketplace. eBay only allows drop shipping from wholesale suppliers, so it can't be in the directory.";

/** Adds https:// when the scheme is missing; returns null for an empty value. */
export function normalizeUrl(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  return /^[a-z][a-z\d+.-]*:\/\//i.test(v) ? v : `https://${v}`;
}

function isHttpUrl(v: string): boolean {
  try {
    const u = new URL(v);
    return (u.protocol === "https:" || u.protocol === "http:") && u.hostname.includes(".");
  } catch {
    return false;
  }
}

/** "Home, Kitchen ,home" -> ["Home", "Kitchen"] (case-insensitive de-dupe, order kept). */
export function parseCategories(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/[,\n]/)) {
    const c = part.trim().replace(/\s+/g, " ");
    if (!c || seen.has(c.toLowerCase())) continue;
    seen.add(c.toLowerCase());
    out.push(c);
  }
  return out;
}

const optionalInt = (max: number, label: string) =>
  z
    .string()
    .trim()
    .transform((v, ctx) => {
      if (v === "") return null;
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0 || n > max) {
        ctx.addIssue({ code: "custom", message: `${label} must be a whole number from 0 to ${max}.` });
        return z.NEVER;
      }
      return n;
    });

const bool = z.boolean();

export const directorySupplierSchema = z
  .object({
    name: z.string().trim().min(2, "Enter the supplier's name.").max(120, "Keep the name under 120 characters."),
    website: z
      .string()
      .max(300, "Keep the website under 300 characters.")
      .transform((v, ctx) => {
        const url = normalizeUrl(v);
        if (url === null) return null;
        if (!isHttpUrl(url)) {
          ctx.addIssue({ code: "custom", message: "Enter a valid website, e.g. https://example-wholesale.com." });
          return z.NEVER;
        }
        if (isBlockedRetailUrl(url)) {
          ctx.addIssue({ code: "custom", message: RETAIL_MESSAGE });
          return z.NEVER;
        }
        return url;
      }),
    categories: z
      .string()
      .max(600)
      .transform((v, ctx) => {
        const list = parseCategories(v);
        if (list.length > 12) ctx.addIssue({ code: "custom", message: "Use at most 12 categories." });
        if (list.some((c) => c.length > 40)) ctx.addIssue({ code: "custom", message: "Keep each category under 40 characters." });
        return list;
      }),
    description: z.string().trim().max(2000, "Keep the description under 2,000 characters."),
    contact_method: z.enum(CONTACT_METHODS, { message: "Choose how sellers contact this supplier." }),
    contact_value: z.string().trim().min(1, "Enter the contact details.").max(300, "Keep the contact details under 300 characters."),
    ships_from: z.string().trim().max(80, "Keep this under 80 characters."),
    us_warehouse: bool,
    typical_handling_days: optionalInt(60, "Handling days"),
    typical_delivery_days: optionalInt(90, "Delivery days"),
    min_order: z.string().trim().max(120, "Keep the minimum order under 120 characters."),
    accepts_dropship: bool,
    blind_shipping: bool,
    provides_tracking: bool,
    csv_feed_available: bool,
    notes: z.string().trim().max(4000, "Keep the notes under 4,000 characters."),
    verified_on: z
      .string()
      .trim()
      .refine((v) => v === "" || (/^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`))), "Enter a date.")
      .transform((v) => v || null),
    status: z.enum(DIRECTORY_STATUSES),
  })
  .superRefine((v, ctx) => {
    const c = v.contact_value;
    switch (v.contact_method) {
      case "email":
        if (!z.email().safeParse(c).success) ctx.addIssue({ code: "custom", path: ["contact_value"], message: "Enter a valid email address." });
        break;
      case "phone":
      case "whatsapp":
        if (c.replace(/\D/g, "").length < 7 || /[^\d+\s().-]/.test(c))
          ctx.addIssue({ code: "custom", path: ["contact_value"], message: "Enter a phone number with country code, e.g. +1 555 010 0000." });
        break;
      case "telegram":
        if (!/^(@?[A-Za-z]\w{3,31}|https:\/\/t\.me\/[A-Za-z]\w{3,31})$/.test(c))
          ctx.addIssue({ code: "custom", path: ["contact_value"], message: "Enter a Telegram username like @wholesaler or a t.me link." });
        break;
      case "portal": {
        const url = normalizeUrl(c) ?? "";
        if (!isHttpUrl(url)) ctx.addIssue({ code: "custom", path: ["contact_value"], message: "Enter the portal's web address." });
        else if (isBlockedRetailUrl(url)) ctx.addIssue({ code: "custom", path: ["contact_value"], message: RETAIL_MESSAGE });
        break;
      }
    }
    if (v.status === "published" && !v.verified_on) {
      ctx.addIssue({ code: "custom", path: ["verified_on"], message: "Add the date you verified this supplier before publishing." });
    }
  })
  .transform((v) => ({
    ...v,
    contact_value: v.contact_method === "portal" ? (normalizeUrl(v.contact_value) as string) : v.contact_value,
    description: v.description || null,
    ships_from: v.ships_from || null,
    min_order: v.min_order || null,
    notes: v.notes || null,
  }));

export type DirectorySupplierInput = z.output<typeof directorySupplierSchema>;

const TEXT_FIELDS = [
  "name", "website", "categories", "description", "contact_method", "contact_value", "ships_from",
  "typical_handling_days", "typical_delivery_days", "min_order", "notes", "verified_on", "status",
] as const;
const BOOL_FIELDS = ["us_warehouse", "accepts_dropship", "blind_shipping", "provides_tracking", "csv_feed_available"] as const;

/** Reads the admin form (FormData or a plain record) into the schema's input shape. */
export function directoryInputFromForm(get: (key: string) => FormDataEntryValue | null | undefined) {
  const out: Record<string, unknown> = {};
  for (const k of TEXT_FIELDS) {
    const v = get(k);
    out[k] = typeof v === "string" ? v : "";
  }
  if (!out.status) out.status = "draft";
  for (const k of BOOL_FIELDS) out[k] = get(k) === "on" || get(k) === "true";
  return out;
}

export function fieldErrorsFrom(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) out[String(issue.path[0] ?? "form")] ??= issue.message;
  return out;
}

/** Private note on a directory supplier. */
export const noteSchema = z.string().trim().max(4000, "Keep the note under 4,000 characters.");
