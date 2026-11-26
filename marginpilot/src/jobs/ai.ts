import type { InngestFunction } from "inngest";
import { inngest, EVENTS } from "@/lib/inngest/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { AUDIT_BATCH_SIZE, finishRun, reviewBatch, scoreStore } from "@/lib/ai-tools/audit-run";
import { chunk } from "@/lib/ai-tools/audit";

/**
 * Listing audit: score every active listing in code, then ask Claude (standard tier)
 * for a recommendation on the lowest-scoring ones, in batches. Results are drafts the
 * seller reviews on /app/ai/audit. Event data: { storeId, requestedBy, runId }.
 */
const listingAudit = inngest.createFunction(
  {
    id: "listing-audit",
    triggers: [{ event: EVENTS.auditRequested }],
    concurrency: { key: "event.data.storeId", limit: 1 },
    retries: 2,
    onFailure: async ({ event }) => {
      const runId = (event.data.event.data as { runId?: string }).runId;
      if (!runId) return;
      await createAdminClient()
        .from("audit_runs")
        .update({ status: "failed", error: "The audit stopped unexpectedly. Please run it again.", finished_at: new Date().toISOString() })
        .eq("id", runId)
        .in("status", ["queued", "running"]);
    },
  },
  async ({ event, step }) => {
    const { runId } = event.data as { runId: string; storeId: string; requestedBy?: string };
    if (!runId) return { skipped: "no runId" };

    const scored = await step.run("score-listings", () => scoreStore(runId));
    const errors: string[] = [];
    const batches = chunk(scored.reviewIds, AUDIT_BATCH_SIZE);
    for (let i = 0; i < batches.length; i++) {
      const res = await step.run(`ai-review-${i}`, () =>
        reviewBatch(runId, { orgId: scored.orgId, storeId: scored.storeId, userId: scored.userId }, batches[i]),
      );
      if (res.error) {
        errors.push(res.error);
        break; // out of credits / AI down: keep the code scores, stop spending
      }
    }
    await step.run("finish", () => finishRun(runId, errors));
    return { total: scored.total, reviewed: scored.reviewIds.length, errors };
  },
);

/** Background jobs for this area. Registered in src/app/api/inngest/route.ts. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const functions: InngestFunction<any, any, any, any>[] = [listingAudit];
