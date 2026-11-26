"use server";

import { revalidatePath } from "next/cache";
import { getAppContext } from "@/lib/auth";
import { undoActivity } from "@/lib/automation/undo-server";
import type { ActionState } from "@/components/ui/form";

export async function undoEntry(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getAppContext();
  if (!ctx.plan) return { ok: false, message: "An active plan is required." };
  const id = Number(String(formData.get("intent") ?? "").replace(/^undo:/, ""));
  if (!Number.isInteger(id) || id <= 0) return { ok: false, message: "Unknown entry." };
  // undoActivity only loads entries in this org.
  const r = await undoActivity(id, { orgId: ctx.org.id, userId: ctx.user.id });
  revalidatePath("/app/activity");
  return r;
}
