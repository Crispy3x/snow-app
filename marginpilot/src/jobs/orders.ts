import type { InngestFunction } from "inngest";
import { inngest, EVENTS } from "@/lib/inngest/client";
import { activeStoreIds, purgeExpiredPii, syncStoreOrders } from "@/lib/automation/orders-sync";
import { withEbayBackoff } from "@/lib/automation/store";

/**
 * Order queue.
 * - every 15 minutes: fan out one sync per active store
 * - per store (on EVENTS.ordersSync): pull new orders, encrypt ship-to, set ship-by and purge date
 * - daily: delete encrypted ship-to data past pii_purge_after
 * Nothing here orders from suppliers; the seller does that and adds tracking.
 */

const ordersCron = inngest.createFunction(
  { id: "orders-cron", triggers: [{ cron: "*/15 * * * *" }] },
  async ({ step }) => {
    const storeIds = await step.run("active-stores", () => activeStoreIds());
    if (storeIds.length) {
      await step.sendEvent(
        "fan-out",
        storeIds.map((storeId) => ({ name: EVENTS.ordersSync, data: { storeId } })),
      );
    }
    return { stores: storeIds.length };
  },
);

const ordersSync = inngest.createFunction(
  {
    id: "orders-sync",
    triggers: [{ event: EVENTS.ordersSync }],
    concurrency: { key: "event.data.storeId", limit: 1 },
    retries: 3,
  },
  async ({ event, step }) => {
    const storeId = String((event.data as { storeId?: string }).storeId ?? "");
    if (!storeId) return { skipped: "no storeId" };
    return step.run("sync", () => withEbayBackoff(() => syncStoreOrders(storeId)));
  },
);

const piiPurge = inngest.createFunction(
  { id: "orders-pii-purge", triggers: [{ cron: "17 3 * * *" }] },
  async ({ step }) => {
    const purged = await step.run("purge", () => purgeExpiredPii());
    return { purged };
  },
);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const functions: InngestFunction<any, any, any, any>[] = [ordersCron, ordersSync, piiPurge];
