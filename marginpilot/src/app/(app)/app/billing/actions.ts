"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { canManage, getAppContext } from "@/lib/auth";
import { getPlan } from "@/config/plans";
import { isPlanKey } from "@/lib/billing/stripe";
import { startPlanForCurrentUser } from "@/lib/billing/start";
import { createPortalSession } from "@/lib/billing/checkout";
import type { ActionState } from "@/components/ui/form";

export async function choosePlan(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const plan = formData.get("plan");
  if (!isPlanKey(plan)) return { ok: false, message: "Choose a plan." };
  const result = await startPlanForCurrentUser(plan, { allowChange: true });
  if (result.kind === "redirect") redirect(result.url);
  if (result.kind === "error") return { ok: false, message: result.message };
  revalidatePath("/app/billing");
  return { ok: true, message: `Switching you to ${getPlan(plan)?.name}. Your plan updates here within a few seconds; refresh if it doesn't.` };
}

export async function openPortal(): Promise<ActionState> {
  const ctx = await getAppContext();
  if (!canManage(ctx.role)) return { ok: false, message: "Only the workspace owner or an admin can manage billing." };
  let url: string;
  try {
    url = await createPortalSession(ctx.org.id, { id: ctx.user.id, email: ctx.user.email });
  } catch (e) {
    console.error("[billing] portal failed", e);
    return { ok: false, message: "We couldn't open the billing portal. Please try again in a minute." };
  }
  redirect(url);
}
