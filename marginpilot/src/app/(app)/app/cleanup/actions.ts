"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStore } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { inngest, EVENTS } from "@/lib/inngest/client";
import { approveCleanup, dismissCleanup } from "@/lib/automation/cleanup-run";
import type { ActionState } from "@/components/ui/form";

export async function scanNow(): Promise<ActionState> {
  const ctx = await requireStore();
  await inngest.send({ name: EVENTS.cleanupStore, data: { storeId: ctx.store.id } });
  return { ok: true, message: "Scan started. Candidates appear here in a minute." };
}

/** intent: "end:<candidateId>" or "dismiss:<candidateId>"; checkbox "replace:<candidateId>" queues a draft replacement. */
export async function decideCleanup(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireStore();
  const [verb, id] = String(formData.get("intent") ?? "").split(":");
  if ((verb !== "end" && verb !== "dismiss") || !z.string().uuid().safeParse(id).success) return { ok: false, message: "Unknown action." };

  const db = createAdminClient();
  const { data: row } = await db
    .from("cleanup_candidates")
    .select("id, listings!inner(store_id)")
    .eq("id", id)
    .eq("org_id", ctx.org.id)
    .eq("listings.store_id", ctx.store.id)
    .maybeSingle();
  if (!row) return { ok: false, message: "Candidate not found." };

  if (verb === "dismiss") {
    await dismissCleanup(id, ctx.org.id);
    revalidatePath("/app/cleanup");
    return { ok: true, message: "Dismissed. This listing won't be suggested again." };
  }
  const r = await approveCleanup(id, { orgId: ctx.org.id, userId: ctx.user.id }, { createReplacement: formData.get(`replace:${id}`) === "on" });
  revalidatePath("/app/cleanup");
  return r;
}
