"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStore } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { inngest, EVENTS } from "@/lib/inngest/client";
import { applyProposal } from "@/lib/automation/monitor-run";
import type { ActionState } from "@/components/ui/form";

const uuid = z.string().uuid();

export async function runCheckNow(): Promise<ActionState> {
  const ctx = await requireStore();
  await inngest.send({ name: EVENTS.monitorStore, data: { storeId: ctx.store.id } });
  return { ok: true, message: "Check started. New proposals appear here in a few minutes." };
}

/** One form for the proposal table: intent is "approve:<id>", "dismiss:<id>", "approve-selected" or "dismiss-selected". */
export async function decideProposals(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireStore();
  const intent = String(formData.get("intent") ?? "");
  const [verb, single] = intent.split(":");
  if (verb !== "approve" && verb !== "dismiss" && verb !== "approve-selected" && verb !== "dismiss-selected") {
    return { ok: false, message: "Unknown action." };
  }
  const raw = single ? [single] : formData.getAll("ids").map(String);
  const ids = raw.filter((id) => uuid.safeParse(id).success).slice(0, 200);
  if (!ids.length) return { ok: false, message: "Select at least one proposal." };

  // Only proposals for listings in the selected store of this org.
  const db = createAdminClient();
  const { data: rows } = await db
    .from("monitor_proposals")
    .select("id, listings!inner(store_id)")
    .in("id", ids)
    .eq("org_id", ctx.org.id)
    .eq("status", "pending")
    .eq("listings.store_id", ctx.store.id);
  const allowed = (rows ?? []).map((r) => r.id as string);
  if (!allowed.length) return { ok: false, message: "Those proposals were already decided." };

  if (verb.startsWith("dismiss")) {
    await db
      .from("monitor_proposals")
      .update({ status: "dismissed", decided_by: ctx.user.id, decided_at: new Date().toISOString() })
      .in("id", allowed)
      .eq("status", "pending");
    revalidatePath("/app/monitor");
    return { ok: true, message: `Dismissed ${allowed.length} proposal${allowed.length === 1 ? "" : "s"}.` };
  }

  let applied = 0;
  const problems: string[] = [];
  for (const id of allowed) {
    const r = await applyProposal(id, { orgId: ctx.org.id, userId: ctx.user.id });
    if (r.ok) applied++;
    else problems.push(r.message);
  }
  revalidatePath("/app/monitor");
  if (allowed.length === 1) return { ok: applied === 1, message: applied ? "Price updated on eBay." : problems[0] };
  const head = `Applied ${applied} of ${allowed.length}.`;
  return { ok: problems.length === 0, message: problems.length ? `${head} ${problems.slice(0, 3).join(" ")}` : head };
}
