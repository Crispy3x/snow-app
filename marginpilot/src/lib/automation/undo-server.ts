import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getEbayClient } from "@/lib/ebay/client";
import { bulkUpdateAdBids, bulkUpdatePriceQuantity, publishOffer, putInventoryItem } from "@/lib/ebay/api";
import { getInventoryItem } from "@/lib/ebay/automation-api";
import { guardPrice } from "@/lib/margin";
import { logActivity, type ActivityEntry } from "@/lib/activity";
import { reverseEntry, type ActivityRow, type UndoDeps, type UndoListing } from "./undo";
import { ebayErrorMessage, guardRules, loadStoreRules } from "./store";

/** Wires the undo reversers to the database and the real eBay client. */

function depsFor(storeId: string): UndoDeps {
  const db = createAdminClient();
  let clientPromise: ReturnType<typeof getEbayClient> | null = null;
  const client = () => (clientPromise ??= getEbayClient(storeId));
  return {
    ebay: {
      async updatePriceQuantity(u) {
        const res = await bulkUpdatePriceQuantity(await client(), [u]);
        const r = res?.responses?.[0];
        if (r && r.statusCode >= 300) throw new Error(`eBay rejected the update: ${JSON.stringify(r.errors ?? []).slice(0, 300)}`);
      },
      publishOffer: async (offerId) => publishOffer(await client(), offerId),
      getInventoryItem: async (sku) => getInventoryItem(await client(), sku),
      putInventoryItem: async (sku, item) => putInventoryItem(await client(), sku, item),
      async updateAdBid(campaignId, ebayListingId, bidPct) {
        await bulkUpdateAdBids(await client(), campaignId, [{ listingId: ebayListingId, bidPct }]);
      },
    },
    async loadListing(id) {
      const { data } = await db
        .from("listings")
        .select("id, sku, ebay_offer_id, ebay_listing_id, price, quantity, status")
        .eq("id", id)
        .eq("store_id", storeId)
        .maybeSingle();
      return data ? ({ ...data, price: Number(data.price) } as UndoListing) : null;
    },
    async updateListing(id, patch) {
      await db.from("listings").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id).eq("store_id", storeId);
    },
    async checkFloor(listingId, price) {
      const { data } = await db.from("listings").select("supplier_products(cost, shipping_cost)").eq("id", listingId).maybeSingle();
      const sp = data?.supplier_products as unknown as { cost: string | number | null; shipping_cost: string | number } | null;
      if (sp?.cost === null || sp?.cost === undefined) return { ok: true, reasons: [] };
      const rules = guardRules(await loadStoreRules(storeId));
      const g = guardPrice(price, { supplierCost: Number(sp.cost), supplierShipping: Number(sp.shipping_cost) || 0 }, rules);
      return { ok: g.ok, reasons: g.reasons };
    },
  };
}

export async function undoActivity(entryId: number, ctx: { orgId: string; userId: string }): Promise<{ ok: boolean; message: string }> {
  const db = createAdminClient();
  const { data } = await db.from("activity_log").select("*").eq("id", entryId).eq("org_id", ctx.orgId).maybeSingle();
  if (!data) return { ok: false, message: "Activity entry not found." };
  const entry = data as ActivityRow;
  if (!entry.store_id) return { ok: false, message: "This entry isn't tied to a store." };

  // Claim the entry so two clicks can't undo twice.
  const claimedAt = new Date().toISOString();
  const { data: claimed } = await db
    .from("activity_log")
    .update({ undone_at: claimedAt })
    .eq("id", entry.id)
    .is("undone_at", null)
    .eq("undoable", true)
    .select("id");
  if (!claimed?.length) return { ok: false, message: "This change was already undone or can't be undone." };

  let result;
  try {
    result = await reverseEntry(entry, depsFor(entry.store_id));
  } catch (e) {
    result = { ok: false as const, message: ebayErrorMessage(e) };
  }
  if (!result.ok) {
    await db.from("activity_log").update({ undone_at: null }).eq("id", entry.id);
    return { ok: false, message: result.message };
  }

  const undoId = await logActivity({
    orgId: entry.org_id,
    storeId: entry.store_id,
    actor: "user",
    userId: ctx.userId,
    entityType: entry.entity_type as ActivityEntry["entityType"],
    entityId: entry.entity_id,
    action: entry.action,
    before: result.before,
    after: { ...result.after, undo: true, ...(result.warning ? { warning: result.warning } : {}) },
    undoable: false,
  });
  if (undoId !== null) await db.from("activity_log").update({ undo_of: entry.id }).eq("id", undoId);
  return { ok: true, message: result.warning ? `Undone. ${result.warning}` : "Undone." };
}
