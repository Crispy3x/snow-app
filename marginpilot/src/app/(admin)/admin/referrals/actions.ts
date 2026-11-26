"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionState } from "@/components/ui/form";
import { adminContext, audit } from "@/lib/admin/server";
import { nextCommissionState, type CommissionStatus, type ReferralStatus } from "@/lib/referrals/commission";

const schema = z.object({
  id: z.uuid(),
  op: z.enum(["approve", "void", "paid", "note"]),
  note: z.string().trim().max(1000, "Keep the note under 1,000 characters."),
});

const DONE: Record<string, string> = {
  approve: "Commission approved.",
  void: "Referral voided.",
  paid: "Marked as paid.",
  note: "Note added.",
};

/** Approve / void / mark paid a commission, or add a note. Payouts themselves happen outside the app. */
export async function updateReferral(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { admin, db } = await adminContext();
  const parsed = schema.safeParse({ id: formData.get("id"), op: formData.get("op"), note: String(formData.get("note") ?? "") });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const { id, op, note } = parsed.data;

  const { data: row } = await db.from("referrals").select("id, status, commission_status, notes, referrer_user_id").eq("id", id).maybeSingle();
  if (!row) return { ok: false, message: "That referral no longer exists." };

  const now = new Date().toISOString();
  const line = note ? `${now.slice(0, 10)} ${admin.email || "admin"}${op === "note" ? "" : ` (${op})`}: ${note}` : null;
  const notes = line ? (row.notes ? `${row.notes}\n${line}` : line) : (row.notes as string | null);

  let patch: Record<string, unknown>;
  if (op === "note") {
    if (!line) return { ok: false, message: "Write a note first." };
    patch = { notes, updated_at: now };
  } else {
    const current = { status: row.status as ReferralStatus, commission_status: row.commission_status as CommissionStatus | null };
    const next = nextCommissionState(current, op);
    if (!next) return { ok: false, message: `Can't ${op === "paid" ? "mark as paid" : op} a referral that is ${current.commission_status ?? current.status}.` };
    patch = {
      ...next,
      notes,
      commission_decided_at: now,
      commission_decided_by: admin.id,
      ...(op === "paid" ? { commission_paid_at: now } : {}),
      updated_at: now,
    };
  }

  // Conditional on the status we read, so two admins can't apply conflicting changes.
  const { error, count } = await db
    .from("referrals")
    .update(patch, { count: "exact" })
    .eq("id", id)
    .eq("status", row.status as string);
  if (error) return { ok: false, message: `Couldn't save: ${error.message}` };
  if (!count) return { ok: false, message: "Someone else changed this referral. Reload and try again." };

  await audit(db, admin.id, `referral_${op}`, {
    targetUserId: (row.referrer_user_id as string | null) ?? null,
    details: { referral_id: id, from: row.commission_status ?? row.status, note: note || undefined },
  });
  revalidatePath("/admin/referrals");
  return { ok: true, message: DONE[op] };
}
