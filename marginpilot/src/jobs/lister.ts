import { RetryAfterError, type InngestFunction } from "inngest";
import { inngest, EVENTS } from "@/lib/inngest/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { EbayRateLimitError } from "@/lib/ebay/client";
import { finishJob, processBulkItem, type BulkJobRow } from "@/lib/lister/pipeline";

/**
 * Bulk lister. One run per bulk job, one step per item so each item retries on
 * its own and progress survives function timeouts. Per-store concurrency keeps
 * one store's big batch from tripping eBay call limits or starving others.
 */
const bulkLister = inngest.createFunction(
  {
    id: "lister-bulk-job",
    name: "Bulk add listings",
    triggers: [{ event: EVENTS.bulkJobCreated }],
    concurrency: { key: "event.data.storeId", limit: 1 },
    retries: 4,
    onFailure: async ({ event, step }) => {
      const jobId = (event.data.event.data as { jobId?: string }).jobId;
      if (jobId) await step.run("mark-failed", () => finishJob(jobId, true));
    },
  },
  async ({ event, step }) => {
    const jobId = (event.data as { jobId: string }).jobId;

    const setup = await step.run("load-job", async () => {
      const db = createAdminClient();
      const { data: job } = await db
        .from("bulk_jobs")
        .select("id, org_id, store_id, created_by, mode, source, supplier_id, target_margin_pct, status")
        .eq("id", jobId)
        .maybeSingle();
      if (!job || job.status === "cancelled" || job.status === "done") return null;
      await db.from("bulk_jobs").update({ status: "running" }).eq("id", jobId);
      const { data: items } = await db.from("bulk_job_items").select("id").eq("job_id", jobId).order("position");
      return { job: job as BulkJobRow, itemIds: (items ?? []).map((i) => i.id as string) };
    });
    if (!setup) return { skipped: true };

    let done = 0, failed = 0;
    for (const itemId of setup.itemIds) {
      const out = await step.run(`item-${itemId}`, async () => {
        try {
          return await processBulkItem(setup.job, itemId);
        } catch (e) {
          if (e instanceof EbayRateLimitError) throw new RetryAfterError("eBay rate limit", e.retryAfterSeconds * 1000, { cause: e });
          throw e;
        }
      });
      if (out.status === "done") done++;
      else failed++;
      // keep the progress counters fresh for the progress page
      if ((done + failed) % 5 === 0) {
        await step.run(`progress-${done + failed}`, async () => {
          await createAdminClient().from("bulk_jobs").update({ succeeded: done, failed }).eq("id", jobId);
        });
      }
    }

    await step.run("finish", () => finishJob(jobId));
    return { done, failed };
  },
);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const functions: InngestFunction<any, any, any, any>[] = [bulkLister];
