import "server-only";
import { RetryAfterError } from "inngest";
import { createAdminClient } from "@/lib/supabase/admin";
import { rulesFromRow, type AdRateTier, type GuardRules } from "@/lib/margin";
import { EbayApiError, EbayRateLimitError } from "@/lib/ebay/client";
import type { MonitorRules } from "./monitor";
import type { BidStrategy } from "./ads";

/** Shared server helpers for the automation area. */

export type StoreRulesRow = {
  store_id: string;
  min_net_margin_pct: string | number;
  final_value_fee_pct: string | number;
  per_order_fee: string | number;
  tax_on_cost_pct: string | number;
  sale_discount_pct: string | number;
  min_price: string | number;
  handling_days: number;
  ad_rate_tiers: AdRateTier[] | null;
  monitor_action: "reprice" | "out_of_stock" | "flag";
  monitor_interval_hours: number;
  reprice_requires_approval: boolean;
  offer_margin_pct: string | number | null;
  cleanup_after_days: number | null;
  cleanup_queue_replacements: boolean;
};

export type StoreAutomationRow = {
  store_id: string;
  org_id: string;
  monitor_last_checked_at: string | null;
  orders_synced_at: string | null;
  cleanup_last_run_at: string | null;
  ad_bid_strategy: BidStrategy;
  ad_campaign_id: string | null;
};

/** Defaults from 0001_init.sql, used when a store has no rules row yet. */
const DEFAULT_RULES: Omit<StoreRulesRow, "store_id"> = {
  min_net_margin_pct: 20,
  final_value_fee_pct: 13.6,
  per_order_fee: 0.4,
  tax_on_cost_pct: 0,
  sale_discount_pct: 0,
  min_price: 0,
  handling_days: 2,
  ad_rate_tiers: [],
  monitor_action: "flag",
  monitor_interval_hours: 12,
  reprice_requires_approval: true,
  offer_margin_pct: null,
  cleanup_after_days: null,
  cleanup_queue_replacements: false,
};

export async function loadStoreRules(storeId: string): Promise<StoreRulesRow> {
  const db = createAdminClient();
  const { data } = await db.from("store_rules").select("*").eq("store_id", storeId).maybeSingle();
  return (data as StoreRulesRow | null) ?? { store_id: storeId, ...DEFAULT_RULES };
}

export function guardRules(row: StoreRulesRow): GuardRules {
  return rulesFromRow(row);
}

export function monitorRules(row: StoreRulesRow): MonitorRules {
  return { ...rulesFromRow(row), monitorAction: row.monitor_action, repriceRequiresApproval: row.reprice_requires_approval };
}

export async function loadAutomationState(storeId: string, orgId: string): Promise<StoreAutomationRow> {
  const db = createAdminClient();
  const { data } = await db.from("store_automation").select("*").eq("store_id", storeId).maybeSingle();
  if (data) return data as StoreAutomationRow;
  const fresh = { store_id: storeId, org_id: orgId };
  await db.from("store_automation").upsert(fresh, { onConflict: "store_id", ignoreDuplicates: true });
  return { ...fresh, monitor_last_checked_at: null, orders_synced_at: null, cleanup_last_run_at: null, ad_bid_strategy: "mid", ad_campaign_id: null };
}

export async function updateAutomationState(storeId: string, orgId: string, patch: Partial<StoreAutomationRow>): Promise<void> {
  const db = createAdminClient();
  await db
    .from("store_automation")
    .upsert({ store_id: storeId, org_id: orgId, ...patch, updated_at: new Date().toISOString() }, { onConflict: "store_id" });
}

export async function storeOrgId(storeId: string): Promise<string | null> {
  const db = createAdminClient();
  const { data } = await db.from("ebay_stores").select("org_id").eq("id", storeId).maybeSingle();
  return (data?.org_id as string | undefined) ?? null;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** User-facing message for an eBay error. Rate limits get a retry hint. */
export function ebayErrorMessage(e: unknown): string {
  if (e instanceof EbayRateLimitError) return `eBay is limiting requests right now. Try again in ${Math.ceil(e.retryAfterSeconds / 60)} min.`;
  if (e instanceof EbayApiError) return `eBay said: ${e.message}`;
  if (e instanceof Error) return e.message;
  return "Something went wrong.";
}

/** In Inngest steps: turn eBay 429s into RetryAfterError so Inngest backs off. */
export async function withEbayBackoff<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof EbayRateLimitError) throw new RetryAfterError(e.message, e.retryAfterSeconds * 1000, { cause: e });
    throw e;
  }
}
