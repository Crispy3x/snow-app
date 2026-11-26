import type { InngestFunction } from "inngest";
import { inngest, EVENTS } from "@/lib/inngest/client";
import { dueMonitorStores, runMonitorGroup, startMonitorRun } from "@/lib/automation/monitor-run";
import { withEbayBackoff } from "@/lib/automation/store";

/**
 * Price and stock monitor.
 * - hourly cron fans out to stores whose monitor_interval_hours has elapsed
 * - per store (one at a time per store): check each supplier's products, then
 *   set out-of-stock / restore automatically and create repricing proposals
 *   (or apply them when the store turned approval off).
 */

const monitorCron = inngest.createFunction(
  { id: "monitor-cron", triggers: [{ cron: "0 * * * *" }] },
  async ({ step }) => {
    const storeIds = await step.run("due-stores", () => dueMonitorStores());
    if (storeIds.length) {
      await step.sendEvent(
        "fan-out",
        storeIds.map((storeId) => ({ name: EVENTS.monitorStore, data: { storeId } })),
      );
    }
    return { stores: storeIds.length };
  },
);

const monitorStore = inngest.createFunction(
  {
    id: "monitor-store",
    triggers: [{ event: EVENTS.monitorStore }],
    concurrency: { key: "event.data.storeId", limit: 1 },
    retries: 3,
  },
  async ({ event, step }) => {
    const storeId = String((event.data as { storeId?: string }).storeId ?? "");
    if (!storeId) return { skipped: "no storeId" };
    const run = await step.run("start", () => startMonitorRun(storeId));
    if (!run) return { skipped: "store not found" };
    const results = [];
    for (const supplierId of run.supplierIds) {
      results.push(await step.run(`supplier-${supplierId}`, () => withEbayBackoff(() => runMonitorGroup(storeId, supplierId))));
    }
    return { suppliers: run.supplierIds.length, results };
  },
);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const functions: InngestFunction<any, any, any, any>[] = [monitorCron, monitorStore];
