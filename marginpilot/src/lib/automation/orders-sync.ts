import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getEbayClient } from "@/lib/ebay/client";
import { createShippingFulfillment, getOrders, type EbayOrder } from "@/lib/ebay/api";
import { encryptJson } from "@/lib/crypto";
import { logActivity } from "@/lib/activity";
import { mapEbayOrder, type ListingMatch } from "./orders";
import { ebayErrorMessage, loadAutomationState, loadStoreRules, storeOrgId, updateAutomationState } from "./store";

/**
 * Order queue sync (src/jobs/orders.ts) and the seller's tracking step (/app/orders).
 * Supplier orders are always placed by the seller; nothing here orders from a supplier.
 */

/** First sync looks back this far. */
const FIRST_SYNC_DAYS = 30;
/** Each sync re-reads a little before the last sync to catch late-indexed orders. */
const OVERLAP_MS = 60 * 60_000;

export async function activeStoreIds(): Promise<string[]> {
  const db = createAdminClient();
  const { data } = await db.from("ebay_stores").select("id, organizations!inner(plan)").eq("status", "active").neq("organizations.plan", "none");
  return (data ?? []).map((s) => s.id as string);
}

export async function syncStoreOrders(storeId: string, now = new Date()): Promise<{ fetched: number; inserted: number; updated: number }> {
  const orgId = await storeOrgId(storeId);
  if (!orgId) return { fetched: 0, inserted: 0, updated: 0 };
  const db = createAdminClient();
  const state = await loadAutomationState(storeId, orgId);
  const since = state.orders_synced_at
    ? new Date(Date.parse(state.orders_synced_at) - OVERLAP_MS)
    : new Date(now.getTime() - FIRST_SYNC_DAYS * 86_400_000);

  const client = await getEbayClient(storeId);
  const orders: EbayOrder[] = [];
  for (let offset = 0; offset < 5000; offset += 50) {
    const page = await getOrders(client, since.toISOString(), offset);
    orders.push(...(page.orders ?? []));
    if (!page.orders || page.orders.length < 50) break;
  }

  let inserted = 0;
  let updated = 0;
  if (orders.length) {
    const rules = await loadStoreRules(storeId);
    const skus = [...new Set(orders.flatMap((o) => o.lineItems.map((li) => li.sku).filter((s): s is string => !!s)))];
    const listingsBySku = new Map<string, ListingMatch>();
    if (skus.length) {
      const { data } = await db.from("listings").select("id, sku, supplier_products(cost)").eq("store_id", storeId).in("sku", skus);
      for (const l of data ?? []) {
        const sp = l.supplier_products as unknown as { cost: string | number | null } | null;
        listingsBySku.set(l.sku as string, { id: l.id as string, supplierCost: sp?.cost === null || sp?.cost === undefined ? null : Number(sp.cost) });
      }
    }

    const { data: existingRows } = await db
      .from("orders")
      .select("id, ebay_order_id, status")
      .eq("store_id", storeId)
      .in("ebay_order_id", orders.map((o) => o.orderId));
    const existing = new Map((existingRows ?? []).map((r) => [r.ebay_order_id as string, r as { id: string; status: string }]));

    for (const o of orders) {
      const { order, lines } = mapEbayOrder(o, {
        orgId,
        storeId,
        handlingDays: rules.handling_days,
        now,
        encrypt: encryptJson,
        listingsBySku,
      });
      const prev = existing.get(o.orderId);
      if (prev) {
        // Keep the seller's workflow status and never re-store purged ship-to data.
        const patch: Record<string, unknown> = { order_total: order.order_total, ebay_fees: order.ebay_fees };
        if (order.status === "cancelled" && prev.status !== "cancelled") patch.status = "cancelled";
        await db.from("orders").update(patch).eq("id", prev.id);
        updated++;
        continue;
      }
      const { data: row, error } = await db.from("orders").insert(order).select("id").single();
      if (error || !row) {
        // A concurrent sync may have inserted it; skip.
        continue;
      }
      if (lines.length) {
        await db.from("order_lines").insert(lines.map((l) => ({ ...l, order_id: row.id })));
      }
      inserted++;
    }
  }

  await updateAutomationState(storeId, orgId, { orders_synced_at: now.toISOString() });
  return { fetched: orders.length, inserted, updated };
}

/** Deletes encrypted ship-to data past its retention date. */
export async function purgeExpiredPii(now = new Date()): Promise<number> {
  const db = createAdminClient();
  const { data, error } = await db
    .from("orders")
    .update({ ship_to_enc: null })
    .lt("pii_purge_after", now.toISOString())
    .not("ship_to_enc", "is", null)
    .select("id");
  if (error) throw new Error(`PII purge failed: ${error.message}`);
  return data?.length ?? 0;
}

/* ---------------- Seller workflow ---------------- */

export async function postTracking(input: {
  orderId: string;
  orgId: string;
  userId: string;
  carrier: string;
  trackingNumber: string;
}): Promise<{ ok: boolean; message: string }> {
  const db = createAdminClient();
  const { data: order } = await db
    .from("orders")
    .select("id, org_id, store_id, ebay_order_id, status, order_lines(ebay_line_item_id, quantity)")
    .eq("id", input.orderId)
    .eq("org_id", input.orgId)
    .maybeSingle();
  if (!order) return { ok: false, message: "Order not found." };
  if (order.status !== "ordered_from_supplier") {
    return { ok: false, message: "Confirm you've placed the supplier order before adding tracking." };
  }
  const lines = (order.order_lines ?? []) as { ebay_line_item_id: string; quantity: number }[];
  if (!lines.length) return { ok: false, message: "This order has no line items." };

  const trackingNumber = input.trackingNumber.trim().toUpperCase();
  try {
    const client = await getEbayClient(order.store_id as string);
    await createShippingFulfillment(client, order.ebay_order_id as string, {
      lineItems: lines.map((l) => ({ lineItemId: l.ebay_line_item_id, quantity: l.quantity })),
      carrier: input.carrier,
      trackingNumber,
    });
  } catch (e) {
    const message = ebayErrorMessage(e);
    await db.from("fulfillments").insert({
      order_id: order.id,
      org_id: input.orgId,
      carrier: input.carrier,
      tracking_number: trackingNumber,
      error: message,
      created_by: input.userId,
    });
    return { ok: false, message };
  }

  const now = new Date().toISOString();
  await db.from("fulfillments").insert({
    order_id: order.id,
    org_id: input.orgId,
    carrier: input.carrier,
    tracking_number: trackingNumber,
    posted_at: now,
    created_by: input.userId,
  });
  await db.from("orders").update({ status: "tracking_posted" }).eq("id", order.id);
  await logActivity({
    orgId: input.orgId,
    storeId: order.store_id as string,
    actor: "user",
    userId: input.userId,
    entityType: "order",
    entityId: order.id as string,
    action: "tracking_posted",
    before: { status: order.status },
    after: { status: "tracking_posted", carrier: input.carrier, trackingNumber, ebayOrderId: order.ebay_order_id },
    undoable: false,
  });
  return { ok: true, message: `Tracking ${trackingNumber} posted to eBay.` };
}
