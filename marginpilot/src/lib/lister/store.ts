import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { GuardRules } from "@/lib/margin";
import { STORE_RULES_COLUMNS, rulesOrDefault } from "./pricing";

/**
 * Store-level inputs the lister needs: margin rules (store_rules) and the
 * default business policies + inventory location (store_settings, created by
 * the eBay area in 0004_ebay.sql). Callers must have authorised the store.
 */

export async function loadStoreRules(storeId: string): Promise<GuardRules> {
  const db = createAdminClient();
  const { data } = await db.from("store_rules").select(STORE_RULES_COLUMNS).eq("store_id", storeId).maybeSingle();
  return rulesOrDefault(data as Parameters<typeof rulesOrDefault>[0]);
}

export type StorePolicies = {
  policies: { fulfillmentPolicyId: string; paymentPolicyId: string; returnPolicyId: string };
  merchantLocationKey: string;
};

export const POLICIES_MISSING_MESSAGE =
  "Set your business policies in store rules (shipping, payment and return policies, plus an inventory location) before publishing. The listing was kept as a draft.";

export async function getStorePolicies(storeId: string): Promise<{ ok: true; value: StorePolicies } | { ok: false; message: string }> {
  const db = createAdminClient();
  const { data, error } = await db
    .from("store_settings")
    .select("fulfillment_policy_id, payment_policy_id, return_policy_id, merchant_location_key")
    .eq("store_id", storeId)
    .maybeSingle();
  // A missing table (migration not applied yet) shows up as an error here.
  if (error || !data) return { ok: false, message: POLICIES_MISSING_MESSAGE };
  const row = data as Record<string, string | null>;
  if (!row.fulfillment_policy_id || !row.payment_policy_id || !row.return_policy_id || !row.merchant_location_key) {
    return { ok: false, message: POLICIES_MISSING_MESSAGE };
  }
  return {
    ok: true,
    value: {
      policies: {
        fulfillmentPolicyId: row.fulfillment_policy_id,
        paymentPolicyId: row.payment_policy_id,
        returnPolicyId: row.return_policy_id,
      },
      merchantLocationKey: row.merchant_location_key,
    },
  };
}
