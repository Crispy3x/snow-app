import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { rulesFromRow, type GuardRules } from "@/lib/margin";
import { runAi } from "@/lib/ai/run";
import {
  AUDIT_SYSTEM,
  AuditBatchSchema,
  buildAuditPrompt,
  rankForReview,
  sanitizeAuditItem,
  scoreListing,
  type AuditScore,
} from "./audit";

/** Server side of the listing audit job (src/jobs/ai.ts). Every query is filtered by org and store. */

export const AUDIT_REVIEW_LIMIT = 50;
export const AUDIT_BATCH_SIZE = 25;

type ListingRow = {
  id: string;
  title: string;
  price: number | string;
  views: number;
  sold: number;
  watchers: number;
  listed_at: string | null;
  created_at: string;
  item_specifics: Record<string, unknown> | null;
  images: unknown[] | null;
  supplier_products: { cost: number | string | null; shipping_cost: number | string | null } | null;
};

export async function loadStoreRules(storeId: string): Promise<GuardRules> {
  const db = createAdminClient();
  const { data } = await db.from("store_rules").select("*").eq("store_id", storeId).maybeSingle();
  return data
    ? rulesFromRow(data)
    : { finalValueFeePct: 13.6, perOrderFee: 0.4, taxOnCostPct: 0, saleDiscountPct: 0, minNetMarginPct: 20, adRateTiers: [] };
}

/** Scores every active listing and stores one audit_items row each. Returns the ids picked for AI review. */
export async function scoreStore(runId: string): Promise<{ orgId: string; storeId: string; userId: string | null; reviewIds: string[]; total: number }> {
  const db = createAdminClient();
  const { data: run } = await db.from("audit_runs").select("id, org_id, store_id, requested_by").eq("id", runId).single();
  if (!run) throw new Error("audit run not found");
  await db.from("audit_runs").update({ status: "running" }).eq("id", runId);

  const rules = await loadStoreRules(run.store_id);
  const rows: ListingRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("listings")
      .select("id, title, price, views, sold, watchers, listed_at, created_at, item_specifics, images, supplier_products(cost, shipping_cost)")
      .eq("org_id", run.org_id)
      .eq("store_id", run.store_id)
      .eq("status", "active")
      .order("id")
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as unknown as ListingRow[]));
    if (!data || data.length < 1000) break;
  }

  const now = Date.now();
  const scores = rows.map((l) => {
    const sp = l.supplier_products;
    return {
      row: l,
      score: scoreListing(
        {
          id: l.id,
          title: l.title,
          price: Number(l.price),
          views: l.views ?? 0,
          sold: l.sold ?? 0,
          watchers: l.watchers ?? 0,
          ageDays: Math.floor((now - Date.parse(l.listed_at ?? l.created_at)) / 86_400_000),
          itemSpecificsCount: Object.keys(l.item_specifics ?? {}).length,
          imageCount: Array.isArray(l.images) ? l.images.length : 0,
          supplierCost: sp?.cost != null ? Number(sp.cost) : null,
          supplierShipping: sp?.shipping_cost != null ? Number(sp.shipping_cost) : 0,
        },
        rules,
      ),
    };
  });

  const items = scores.map(({ row, score }) => ({
    run_id: runId,
    org_id: run.org_id,
    store_id: run.store_id,
    listing_id: row.id,
    title: row.title,
    score: score.score,
    metrics: { ...score.metrics, parts: score.parts, hint: score.hint },
    issues: score.issues,
  }));
  for (let i = 0; i < items.length; i += 500) {
    const { error } = await db.from("audit_items").insert(items.slice(i, i + 500));
    if (error) throw new Error(error.message);
  }
  await db.from("audit_runs").update({ total_listings: items.length }).eq("id", runId);

  const review = rankForReview(scores.map((s) => s.score), AUDIT_REVIEW_LIMIT).map((s) => s.listingId);
  return { orgId: run.org_id, storeId: run.store_id, userId: run.requested_by, reviewIds: review, total: items.length };
}

type ItemRow = { id: string; listing_id: string; title: string; score: number; issues: string[]; metrics: AuditScore["metrics"] & { hint: AuditScore["hint"] } };

/** One AI call for one batch of listings. Returns an error message when the AI call fails (shown on the run). */
export async function reviewBatch(runId: string, ctx: { orgId: string; storeId: string; userId: string | null }, listingIds: string[]): Promise<{ analyzed: number; error?: string }> {
  const db = createAdminClient();
  const { data } = await db
    .from("audit_items")
    .select("id, listing_id, title, score, issues, metrics")
    .eq("run_id", runId)
    .eq("org_id", ctx.orgId)
    .in("listing_id", listingIds);
  const rows = (data ?? []) as ItemRow[];
  if (!rows.length) return { analyzed: 0 };

  const scores = rows.map((r) => ({
    title: r.title,
    score: { listingId: r.listing_id, score: r.score, issues: r.issues, metrics: r.metrics, hint: r.metrics.hint } as AuditScore,
  }));

  const res = await runAi({
    orgId: ctx.orgId,
    userId: ctx.userId,
    storeId: ctx.storeId,
    tool: "listing_audit",
    system: AUDIT_SYSTEM,
    messages: [{ role: "user", content: `Audit these ${rows.length} listings:\n${buildAuditPrompt(scores)}` }],
    schema: AuditBatchSchema,
    maxTokens: 12000,
  });
  if (!res.ok) return { analyzed: 0, error: res.message };

  const byListing = new Map(scores.map((s) => [s.score.listingId, s.score]));
  const itemId = new Map(rows.map((r) => [r.listing_id, r.id]));
  let analyzed = 0;
  for (const item of res.output.items) {
    const score = byListing.get(item.listingId);
    const id = itemId.get(item.listingId);
    if (!score || !id) continue; // ignore ids the model made up
    await db
      .from("audit_items")
      .update({ ...sanitizeAuditItem(item, score), ai_request_id: res.requestId || null })
      .eq("id", id)
      .eq("org_id", ctx.orgId);
    analyzed++;
  }

  const { data: run } = await db.from("audit_runs").select("analyzed, ai_request_ids").eq("id", runId).single();
  await db
    .from("audit_runs")
    .update({
      analyzed: (run?.analyzed ?? 0) + analyzed,
      ai_request_ids: [...((run?.ai_request_ids as string[]) ?? []), ...(res.requestId ? [res.requestId] : [])],
    })
    .eq("id", runId);
  return { analyzed };
}

export async function finishRun(runId: string, errors: string[]) {
  const db = createAdminClient();
  const { data: run } = await db.from("audit_runs").select("analyzed").eq("id", runId).single();
  await db
    .from("audit_runs")
    .update({
      status: errors.length && !run?.analyzed ? "failed" : "done",
      error: errors.length ? [...new Set(errors)].join(" ") : null,
      finished_at: new Date().toISOString(),
    })
    .eq("id", runId);
}
