"use server";

import { revalidatePath } from "next/cache";
import { requirePlan } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "@/components/ui/form";
import { planHasMentorship } from "@/lib/directory/entitlement";
import { auditRequestWindow, weekLabel } from "@/lib/mentorship/iso-week";
import { auditRequestSchema, fieldErrorsFrom } from "@/lib/mentorship/validation";

/** Request this ISO week's store audit. One per workspace per week (also a unique constraint). */
export async function requestAudit(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requirePlan();
  if (!planHasMentorship(ctx.org.plan)) return { ok: false, message: "Weekly store audits are part of the Mentorship plan." };
  const parsed = auditRequestSchema.safeParse({ store_id: formData.get("store_id"), seller_notes: formData.get("seller_notes") ?? "" });
  if (!parsed.success) return { ok: false, message: "Check the highlighted fields.", fieldErrors: fieldErrorsFrom(parsed.error) };
  if (!ctx.stores.some((s) => s.id === parsed.data.store_id)) {
    return { ok: false, message: "Choose one of your workspace's stores.", fieldErrors: { store_id: "Choose one of your stores." } };
  }

  const supabase = await createClient();
  const now = new Date();
  const { data: existing } = await supabase
    .from("store_audit_requests")
    .select("week_of")
    .eq("org_id", ctx.org.id)
    .gte("week_of", new Date(now.getTime() - 8 * 86_400_000).toISOString().slice(0, 10));
  const win = auditRequestWindow((existing ?? []) as { week_of: string }[], now);
  if (!win.allowed) {
    return { ok: false, message: `Your workspace already requested the audit for ${weekLabel(win.weekOf)}. You can request the next one from ${weekLabel(win.nextWeekOf)}.` };
  }

  const { error } = await supabase.from("store_audit_requests").insert({
    org_id: ctx.org.id,
    store_id: parsed.data.store_id,
    requested_by: ctx.user.id,
    week_of: win.weekOf,
    seller_notes: parsed.data.seller_notes,
    status: "requested",
  });
  if (error) {
    if (error.code === "23505") return { ok: false, message: `Your workspace already requested the audit for ${weekLabel(win.weekOf)}.` };
    return { ok: false, message: "Couldn't send the request. Please try again." };
  }
  revalidatePath("/app/mentorship");
  revalidatePath("/admin/mentorship", "layout");
  return { ok: true, message: `Requested the audit for ${weekLabel(win.weekOf)}. Written feedback will appear below when it's ready.` };
}
