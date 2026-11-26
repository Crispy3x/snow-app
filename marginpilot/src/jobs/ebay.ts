import { RetryAfterError, type InngestFunction } from "inngest";
import { inngest, EVENTS } from "@/lib/inngest/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { getEbayClient, EbayApiError, EbayRateLimitError } from "@/lib/ebay/client";
import { EbayAuthError } from "@/lib/ebay/oauth";
import { getListingTraffic, getPrivileges } from "@/lib/ebay/api";
import { getDailyTraffic } from "@/lib/ebay/store-api";
import { rulesFromRow, DEFAULT_FEES } from "@/lib/margin";
import { dailyMetrics, lastDays, parseTraffic, type MetricOrder } from "@/lib/dashboard/metrics";

/**
 * eBay store jobs:
 *  - ebay-store-sync: on connect, on request, and every 6 hours per active store.
 *    Refreshes selling limits, recomputes store_daily_metrics from the orders
 *    table (orders are synced by src/jobs/orders.ts), pulls listing views/sold.
 *  - ebay-account-deletion: irreversible deletion for eBay's Marketplace
 *    Account Deletion notifications.
 */

const METRIC_WINDOW_DAYS = 90;
const TRAFFIC_WINDOW_DAYS = 90;

/** Rate limits back off through Inngest; auth failures stop quietly (store is marked needs_reauth). */
async function ebayStep<T>(fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    if (e instanceof EbayRateLimitError) throw new RetryAfterError(e.message, e.retryAfterSeconds * 1000, { cause: e });
    if (e instanceof EbayAuthError || e instanceof EbayApiError) return { ok: false, error: e.message };
    throw e;
  }
}

const toIsoDay = (v: string) => (/^\d{8}$/.test(v) ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}` : v.slice(0, 10));

const syncStore = inngest.createFunction(
  {
    id: "ebay-store-sync",
    triggers: [{ event: EVENTS.storeConnected }, { event: EVENTS.storeSyncRequested }],
    concurrency: { key: "event.data.storeId", limit: 1 },
    retries: 3,
  },
  async ({ event, step }) => {
    const storeId = String((event.data as { storeId?: string }).storeId ?? "");
    if (!storeId) return { skipped: "no storeId" };

    const store = await step.run("load-store", async () => {
      const db = createAdminClient();
      const { data } = await db.from("ebay_stores").select("id, org_id, status").eq("id", storeId).maybeSingle();
      return data as { id: string; org_id: string; status: string } | null;
    });
    if (!store || store.status !== "active") return { skipped: "store not active" };

    const limits = await step.run("selling-limits", async () => {
      const r = await ebayStep(async () => getPrivileges(await getEbayClient(storeId)));
      if (!r.ok) return { error: r.error };
      const amount = r.value.sellingLimit?.amount?.value;
      const quantity = r.value.sellingLimit?.quantity;
      await createAdminClient()
        .from("ebay_stores")
        .update({
          selling_limit_amount: amount !== undefined ? Number(amount) : null,
          selling_limit_quantity: quantity ?? null,
        })
        .eq("id", storeId);
      return { amount, quantity };
    });

    const metrics = await step.run("daily-metrics", async () => {
      const db = createAdminClient();
      const { data: ruleRow } = await db.from("store_rules").select("*").eq("store_id", storeId).maybeSingle();
      const rules = ruleRow ? rulesFromRow(ruleRow) : DEFAULT_FEES;
      const days = lastDays(METRIC_WINDOW_DAYS);
      const since = `${days[0]}T00:00:00Z`;

      const orders: MetricOrder[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await db
          .from("orders")
          .select("status, order_total, ebay_fees, created_on_ebay, created_at, lines:order_lines(quantity, sale_price, supplier_cost)")
          .eq("store_id", storeId)
          .or(`created_on_ebay.gte.${since},and(created_on_ebay.is.null,created_at.gte.${since})`)
          .order("id")
          .range(from, from + 999);
        if (error) throw new Error(error.message);
        orders.push(...((data ?? []) as unknown as MetricOrder[]));
        if (!data || data.length < 1000) break;
      }

      const computed = new Map(dailyMetrics(orders, rules).map((d) => [d.day, d]));
      // Write every day in the window so days whose orders were cancelled drop back to zero.
      // Only these columns are upserted; active_listings and views of past days are kept.
      const rows = days.map((day) => {
        const d = computed.get(day);
        return {
          store_id: storeId,
          org_id: store.org_id,
          day,
          sales: d?.sales ?? 0,
          orders: d?.orders ?? 0,
          net_profit: d?.net_profit ?? 0,
          avg_margin_pct: d?.avg_margin_pct ?? null,
        };
      });
      const { error } = await db.from("store_daily_metrics").upsert(rows, { onConflict: "store_id,day" });
      if (error) throw new Error(error.message);

      const { count } = await db
        .from("listings")
        .select("id", { count: "exact", head: true })
        .eq("store_id", storeId)
        .eq("status", "active");
      await db
        .from("store_daily_metrics")
        .upsert(
          { store_id: storeId, org_id: store.org_id, day: days[days.length - 1], active_listings: count ?? 0 },
          { onConflict: "store_id,day" },
        );
      return { orders: orders.length, days: computed.size, activeListings: count ?? 0 };
    });

    const traffic = await step.run("listing-traffic", async () => {
      const to = new Date();
      const from = new Date(to.getTime() - (TRAFFIC_WINDOW_DAYS - 1) * 86_400_000);
      const r = await ebayStep(async () => {
        const c = await getEbayClient(storeId);
        const [byListing, byDay] = await Promise.all([getListingTraffic(c, from, to), getDailyTraffic(c, from, to)]);
        return { byListing, byDay };
      });
      if (!r.ok) return { error: r.error };
      const db = createAdminClient();

      const listings = [...parseTraffic(r.value.byListing).entries()];
      for (let i = 0; i < listings.length; i += 50) {
        await Promise.all(
          listings.slice(i, i + 50).map(([listingId, m]) =>
            db
              .from("listings")
              .update({ views: m.LISTING_VIEWS_TOTAL ?? 0, sold: m.TRANSACTION ?? 0 })
              .eq("store_id", storeId)
              .eq("ebay_listing_id", listingId),
          ),
        );
      }

      const dayRows = [...parseTraffic(r.value.byDay).entries()].map(([day, m]) => ({
        store_id: storeId,
        org_id: store.org_id,
        day: toIsoDay(day),
        views: m.LISTING_VIEWS_TOTAL ?? 0,
      }));
      if (dayRows.length) await db.from("store_daily_metrics").upsert(dayRows, { onConflict: "store_id,day" });
      return { listings: listings.length, days: dayRows.length };
    });

    return { limits, metrics, traffic };
  },
);

const syncAllStores = inngest.createFunction(
  { id: "ebay-store-sync-cron", triggers: [{ cron: "0 */6 * * *" }] },
  async ({ step }) => {
    const storeIds = await step.run("active-stores", async () => {
      const { data } = await createAdminClient().from("ebay_stores").select("id").eq("status", "active");
      return (data ?? []).map((s) => s.id as string);
    });
    if (storeIds.length) {
      await step.sendEvent(
        "fan-out",
        storeIds.map((storeId) => ({ name: EVENTS.storeSyncRequested, data: { storeId } })),
      );
    }

    // Safety net: deletion notices stored but never processed (e.g. the enqueue failed).
    const stuck = await step.run("unprocessed-deletions", async () => {
      const cutoff = new Date(Date.now() - 30 * 60_000).toISOString();
      const { data } = await createAdminClient()
        .from("ebay_notifications")
        .select("id, ebay_user_id, payload")
        .eq("topic", "MARKETPLACE_ACCOUNT_DELETION")
        .is("processed_at", null)
        .lt("received_at", cutoff)
        .limit(500);
      return (data ?? []).map((n) => ({
        notificationId: n.id as string,
        ebayUserId: (n.ebay_user_id as string | null) ?? null,
        username: ((n.payload as { notification?: { data?: { username?: string } } })?.notification?.data?.username ?? null) as string | null,
      }));
    });
    if (stuck.length) {
      await step.sendEvent(
        "retry-deletions",
        stuck.map((data) => ({ name: EVENTS.ebayAccountDeleted, data })),
      );
    }
    return { stores: storeIds.length, deletionsRetried: stuck.length };
  },
);

const accountDeletion = inngest.createFunction(
  {
    id: "ebay-account-deletion",
    triggers: [{ event: EVENTS.ebayAccountDeleted }],
    concurrency: { key: "event.data.notificationId", limit: 1 },
    retries: 10,
  },
  async ({ event, step }) => {
    const { ebayUserId, username, notificationId } = event.data as {
      ebayUserId: string | null;
      username?: string | null;
      notificationId: string;
    };

    const already = await step.run("check", async () => {
      const { data } = await createAdminClient().from("ebay_notifications").select("processed_at").eq("id", notificationId).maybeSingle();
      return !!data?.processed_at;
    });
    if (already) return { skipped: "already processed" };

    const result = await step.run("delete-data", async () => {
      const db = createAdminClient();
      const { data, error } = await db.rpc("ebay_delete_account_data", {
        p_ebay_user_id: ebayUserId ?? null,
        p_username: username ?? null,
      });
      if (error) {
        await db.from("ebay_notifications").update({ error: error.message }).eq("id", notificationId);
        throw new Error(error.message);
      }
      return data as Record<string, number>;
    });

    await step.run("mark-processed", async () => {
      await createAdminClient()
        .from("ebay_notifications")
        // keep only the notification id as proof of processing; drop the user's identifiers
        .update({
          processed_at: new Date().toISOString(),
          error: null,
          ebay_user_id: null,
          payload: { redacted: true, topic: "MARKETPLACE_ACCOUNT_DELETION" },
        })
        .eq("id", notificationId);
    });
    // No activity_log entry: the org's log rows for these stores are deleted too, by design.
    return result;
  },
);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const functions: InngestFunction<any, any, any, any>[] = [syncStore, syncAllStores, accountDeletion];
