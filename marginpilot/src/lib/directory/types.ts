export const CONTACT_METHODS = ["email", "phone", "whatsapp", "telegram", "portal"] as const;
export type ContactMethod = (typeof CONTACT_METHODS)[number];

export const CONTACT_LABEL: Record<ContactMethod, string> = {
  email: "Email",
  phone: "Phone",
  whatsapp: "WhatsApp",
  telegram: "Telegram",
  portal: "Wholesale portal",
};

export const DIRECTORY_STATUSES = ["draft", "published", "archived"] as const;
export type DirectoryStatus = (typeof DIRECTORY_STATUSES)[number];

/** Columns safe to show in lists (no contact details). */
export type DirectoryListRow = {
  id: string;
  name: string;
  website: string | null;
  categories: string[];
  description: string | null;
  ships_from: string | null;
  us_warehouse: boolean;
  typical_handling_days: number | null;
  typical_delivery_days: number | null;
  min_order: string | null;
  accepts_dropship: boolean;
  blind_shipping: boolean;
  provides_tracking: boolean;
  csv_feed_available: boolean;
  verified_on: string | null;
  sort_order: number;
};

export type DirectorySupplier = DirectoryListRow & {
  contact_method: ContactMethod;
  contact_value: string;
  notes: string | null;
  status: DirectoryStatus;
  verified_by: string | null;
  updated_at: string;
};

export const LIST_COLUMNS =
  "id, name, website, categories, description, ships_from, us_warehouse, typical_handling_days, typical_delivery_days, min_order, accepts_dropship, blind_shipping, provides_tracking, csv_feed_available, verified_on, sort_order";

export const DETAIL_COLUMNS = `${LIST_COLUMNS}, contact_method, contact_value, notes, status, verified_by, updated_at`;

/** Link for a contact value, or null when it's not something a browser can open. */
export function contactHref(method: ContactMethod, value: string): string | null {
  const v = value.trim();
  switch (method) {
    case "email":
      return `mailto:${v}`;
    case "phone":
      return `tel:${v.replace(/[^\d+]/g, "")}`;
    case "whatsapp":
      return `https://wa.me/${v.replace(/\D/g, "")}`;
    case "telegram":
      return `https://t.me/${v.replace(/^@/, "").replace(/^https?:\/\/t\.me\//, "")}`;
    case "portal":
      return /^https?:\/\//i.test(v) ? v : null;
  }
}

/** "Nov 26, 2026" for a YYYY-MM-DD date or ISO timestamp (UTC). */
export function formatDay(value: string | null | undefined): string {
  if (!value) return "–";
  const d = value.length === 10 ? new Date(`${value}T00:00:00Z`) : new Date(value);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}
