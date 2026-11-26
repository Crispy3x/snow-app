import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { BRAND } from "@/config/brand";
import { DEFAULT_FEES, rulesFromRow, type GuardRules } from "@/lib/margin";
import { countLowMargin, sumMetrics, type MetricRow, type SnapshotListing } from "./snapshot-calc";

export const MENTORSHIP_BUCKET = "mentorship-resources";

/** Booking link for 1:1 time, shown on /app/mentorship when set. */
export function bookingUrl(): string | null {
  const v = process.env.MENTORSHIP_BOOKING_URL?.trim();
  if (!v) return null;
  try {
    const u = new URL(v);
    return u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

export type StoreSnapshot = {
  activeListings: number;
  sales30: number;
  net30: number;
  orders30: number;
  metricDays: number;
  lowMargin: number;
  unknownMargin: number;
  marginFloor: number;
  checkedListings: number;
};

const SNAPSHOT_LISTING_CAP = 5000;

/** Quick numbers for the admin audit view. Call only with the service-role client after requireAdmin(). */
export async function storeSnapshot(db: SupabaseClient, orgId: string, storeId: string, now = new Date()): Promise<StoreSnapshot> {
  const since = new Date(now.getTime() - 30 * 86_400_000).toISOString().slice(0, 10);
  const [activeCount, metrics, rulesRes, listingsRes] = await Promise.all([
    db.from("listings").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("store_id", storeId).eq("status", "active"),
    db.from("store_daily_metrics").select("day, sales, net_profit, orders").eq("org_id", orgId).eq("store_id", storeId).gte("day", since),
    db
      .from("store_rules")
      .select("final_value_fee_pct, per_order_fee, tax_on_cost_pct, sale_discount_pct, min_net_margin_pct, min_price, ad_rate_tiers")
      .eq("store_id", storeId)
      .maybeSingle(),
    db
      .from("listings")
      .select("price, net_margin_pct, manual_cost, manual_shipping_cost, supplier_products(cost, shipping_cost)")
      .eq("org_id", orgId)
      .eq("store_id", storeId)
      .eq("status", "active")
      .limit(SNAPSHOT_LISTING_CAP),
  ]);
  const rules: GuardRules = rulesRes.data ? rulesFromRow(rulesRes.data) : { ...DEFAULT_FEES, minNetMarginPct: 20 };
  const listings = (listingsRes.data ?? []) as unknown as SnapshotListing[];
  const m = sumMetrics((metrics.data ?? []) as MetricRow[]);
  const margin = countLowMargin(listings, rules);
  return {
    activeListings: activeCount.count ?? 0,
    sales30: m.sales,
    net30: m.net,
    orders30: m.orders,
    metricDays: m.days,
    lowMargin: margin.low,
    unknownMargin: margin.unknown,
    marginFloor: rules.minNetMarginPct,
    checkedListings: listings.length,
  };
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/**
 * Tells the workspace owner their written audit feedback is ready, through Resend's
 * REST API when RESEND_API_KEY is set. The email links to the app rather than
 * including the feedback. Returns false when not configured or on failure.
 */
export async function sendAuditDeliveredEmail(input: { to: string; orgName: string; weekLabel: string; fetchImpl?: typeof fetch }): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return false;
  const from = process.env.EMAIL_FROM || `${BRAND.name} <${BRAND.supportEmail}>`;
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
  const link = `${appUrl}/app/mentorship#audits`;
  const subject = `Your store audit feedback is ready (${input.weekLabel})`;
  const text = [
    `The written feedback on your store audit for ${input.weekLabel} is ready in ${BRAND.name}.`,
    "",
    `Read it here: ${link}`,
  ].join("\n");
  const html = `<p>The written feedback on your store audit for ${escapeHtml(input.weekLabel)} (${escapeHtml(input.orgName)}) is ready in ${escapeHtml(BRAND.name)}.</p>
<p><a href="${escapeHtml(link)}">Read your feedback</a></p>`;
  try {
    const res = await (input.fetchImpl ?? fetch)("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [input.to], subject, text, html }),
    });
    if (!res.ok) {
      console.error("[mentorship] Resend rejected audit email", res.status, await res.text().catch(() => ""));
      return false;
    }
    return true;
  } catch (e) {
    console.error("[mentorship] audit email failed", e);
    return false;
  }
}

export type ResourceRow = {
  id: string;
  title: string;
  description: string | null;
  url: string | null;
  storage_path: string | null;
  file_name: string | null;
  sort_order: number;
};

/**
 * Resources with a usable href: the external URL, or a 10-minute signed URL for an
 * uploaded file. Call only after checking the viewer is entitled (or an admin).
 */
export async function resourcesWithLinks(db: SupabaseClient, rows: ResourceRow[]): Promise<(ResourceRow & { href: string | null })[]> {
  const paths = rows.map((r) => r.storage_path).filter((p): p is string => !!p);
  const signed = new Map<string, string>();
  if (paths.length) {
    const { data } = await db.storage.from(MENTORSHIP_BUCKET).createSignedUrls(paths, 600);
    for (const d of data ?? []) if (d.path && d.signedUrl) signed.set(d.path, d.signedUrl);
  }
  return rows.map((r) => ({ ...r, href: r.url ?? (r.storage_path ? (signed.get(r.storage_path) ?? null) : null) }));
}
