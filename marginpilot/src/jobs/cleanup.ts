import type { InngestFunction } from "inngest";
import { inngest, EVENTS } from "@/lib/inngest/client";
import { cleanupStoreIds, scanStoreForCleanup } from "@/lib/automation/cleanup-run";

/**
 * Cleanup: daily scan of stores with cleanup_after_days set. Stale listings
 * (no views, no sales) become candidates the seller approves; nothing is ended automatically.
 */

const cleanupCron = inngest.createFunction(
  { id: "cleanup-cron", triggers: [{ cron: "41 4 * * *" }] },
  async ({ step }) => {
    const storeIds = await step.run("stores", () => cleanupStoreIds());
    if (storeIds.length) {
      await step.sendEvent(
        "fan-out",
        storeIds.map((storeId) => ({ name: EVENTS.cleanupStore, data: { storeId } })),
      );
    }
    return { stores: storeIds.length };
  },
);

const cleanupStore = inngest.createFunction(
  { id: "cleanup-store", triggers: [{ event: EVENTS.cleanupStore }], concurrency: { key: "event.data.storeId", limit: 1 } },
  async ({ event, step }) => {
    const storeId = String((event.data as { storeId?: string }).storeId ?? "");
    if (!storeId) return { skipped: "no storeId" };
    return step.run("scan", () => scanStoreForCleanup(storeId));
  },
);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const functions: InngestFunction<any, any, any, any>[] = [cleanupCron, cleanupStore];
