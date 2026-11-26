"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStore } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { inngest, EVENTS } from "@/lib/inngest/client";
import { postTracking } from "@/lib/automation/orders-sync";
import { CARRIERS, isValidTracking } from "@/lib/automation/orders";
import type { ActionState } from "@/components/ui/form";

export async function syncOrdersNow(): Promise<ActionState> {
  const ctx = await requireStore();
  await inngest.send({ name: EVENTS.ordersSync, data: { storeId: ctx.store.id } });
  return { ok: true, message: "Sync started. New orders appear here in a minute." };
}

/** The seller confirms they placed the supplier order themselves. Nothing is ordered automatically. */
export async function markOrdered(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireStore();
  const id = z.string().uuid().safeParse(formData.get("orderId"));
  if (!id.success) return { ok: false, message: "Order not found." };
  const db = createAdminClient();
  const { data } = await db
    .from("orders")
    .update({ status: "ordered_from_supplier" })
    .eq("id", id.data)
    .eq("org_id", ctx.org.id)
    .eq("store_id", ctx.store.id)
    .eq("status", "new")
    .select("id");
  revalidatePath("/app/orders");
  if (!data?.length) return { ok: false, message: "This order isn't waiting for a supplier order." };
  return { ok: true, message: "Marked as ordered from the supplier. Add tracking when you have it." };
}

const trackingSchema = z.object({
  orderId: z.string().uuid(),
  carrier: z.enum(CARRIERS.map((c) => c.value) as [string, ...string[]]),
  trackingNumber: z.string().trim().refine(isValidTracking, "Enter the tracking number (letters and digits, 6 to 40 characters)."),
});

export async function addTracking(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireStore();
  const parsed = trackingSchema.safeParse({
    orderId: formData.get("orderId"),
    carrier: formData.get("carrier"),
    trackingNumber: formData.get("trackingNumber"),
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0])] = issue.message;
    return { ok: false, message: fieldErrors.trackingNumber ?? "Check the carrier and tracking number.", fieldErrors };
  }
  const db = createAdminClient();
  const { data: order } = await db.from("orders").select("id").eq("id", parsed.data.orderId).eq("org_id", ctx.org.id).eq("store_id", ctx.store.id).maybeSingle();
  if (!order) return { ok: false, message: "Order not found." };
  const r = await postTracking({ ...parsed.data, orgId: ctx.org.id, userId: ctx.user.id });
  revalidatePath("/app/orders");
  return r;
}
