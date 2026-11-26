"use server";

import { revalidatePath } from "next/cache";
import { requireStore } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { aiCreditBalance } from "@/lib/limits";
import { AI_TOOLS } from "@/config/ai";
import { inngest, EVENTS } from "@/lib/inngest/client";
import { isUuid, setAiDraftStatus } from "@/lib/ai-tools/drafts";
import type { ActionState } from "@/components/ui/form";

export async function requestAudit(): Promise<ActionState> {
  const ctx = await requireStore();
  const db = createAdminClient();

  const { data: running } = await db
    .from("audit_runs")
    .select("id, created_at")
    .eq("org_id", ctx.org.id)
    .eq("store_id", ctx.store.id)
    .in("status", ["queued", "running"])
    .gte("created_at", new Date(Date.now() - 60 * 60_000).toISOString())
    .limit(1);
  if (running?.length) return { ok: false, message: "An audit is already running for this store." };

  const balance = await aiCreditBalance(ctx.org.id);
  if (balance.remaining < AI_TOOLS.listing_audit.credits) {
    return { ok: false, message: "You've used this month's AI credits. They reset on the 1st, or upgrade your plan for more." };
  }

  const { data: run, error } = await db
    .from("audit_runs")
    .insert({ org_id: ctx.org.id, store_id: ctx.store.id, requested_by: ctx.user.id, status: "queued" })
    .select("id")
    .single();
  if (error || !run) return { ok: false, message: "Couldn't start the audit. Please try again." };

  try {
    await inngest.send({ name: EVENTS.auditRequested, data: { storeId: ctx.store.id, requestedBy: ctx.user.id, runId: run.id } });
  } catch {
    await db.from("audit_runs").update({ status: "failed", error: "Couldn't queue the audit." }).eq("id", run.id);
    return { ok: false, message: "Couldn't queue the audit. Please try again." };
  }
  revalidatePath("/app/ai/audit");
  return { ok: true, message: "Audit started. Results appear here in a few minutes; refresh to check." };
}

/** Approve (keep the recommendation as a to-do) or dismiss one AI recommendation. */
export async function decideAuditItem(formData: FormData) {
  const ctx = await requireStore();
  const id = formData.get("itemId");
  const decision = formData.get("decision");
  if (!isUuid(id) || (decision !== "approved" && decision !== "rejected")) return;
  const db = createAdminClient();
  const { data } = await db
    .from("audit_items")
    .update({ draft_status: decision, decided_by: ctx.user.id })
    .eq("id", id)
    .eq("org_id", ctx.org.id)
    .eq("store_id", ctx.store.id)
    .select("ai_request_id")
    .maybeSingle();
  if (data?.ai_request_id) {
    // A batch request counts as approved once any of its items is approved.
    if (decision === "approved") await setAiDraftStatus(ctx.org.id, data.ai_request_id, "approved");
    else {
      const { count } = await db
        .from("audit_items")
        .select("id", { count: "exact", head: true })
        .eq("ai_request_id", data.ai_request_id)
        .eq("org_id", ctx.org.id)
        .neq("draft_status", "rejected");
      if (!count) await setAiDraftStatus(ctx.org.id, data.ai_request_id, "rejected");
    }
  }
  revalidatePath("/app/ai/audit");
}
