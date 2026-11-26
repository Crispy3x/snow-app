"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionState } from "@/components/ui/form";
import { adminContext, audit } from "@/lib/admin/server";
import { creditPeriodStart } from "@/lib/limits";

const orgId = z.string().uuid("Unknown workspace.");

function revalidateOrg(id: string) {
  revalidatePath(`/admin/users/${id}`);
  revalidatePath("/admin/users");
  revalidatePath("/admin");
}

async function orgExists(db: Awaited<ReturnType<typeof adminContext>>["db"], id: string) {
  const { data } = await db.from("organizations").select("id, plan").eq("id", id).maybeSingle();
  return data as { id: string; plan: string } | null;
}

const planSchema = z.object({
  orgId,
  plan: z.enum(["none", "starter", "professional", "mentorship"], { message: "Choose a plan." }),
  note: z.string().trim().min(3, "Say why (for the audit log).").max(300),
});

/** Manual plan override. Stripe stays the source of truth for billing; this only changes what the app unlocks. */
export async function setPlanOverride(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { admin, db } = await adminContext();
  const parsed = planSchema.safeParse({
    orgId: formData.get("orgId"),
    plan: formData.get("plan"),
    note: formData.get("note") ?? "",
  });
  if (!parsed.success) {
    return { ok: false, message: "Check the form.", fieldErrors: { [String(parsed.error.issues[0].path[0])]: parsed.error.issues[0].message } };
  }
  const org = await orgExists(db, parsed.data.orgId);
  if (!org) return { ok: false, message: "Workspace not found." };

  const { error } = await db
    .from("organizations")
    .update({
      plan: parsed.data.plan,
      plan_manual_override: true,
      plan_override_note: parsed.data.note,
      plan_override_at: new Date().toISOString(),
      plan_override_by: admin.id,
    })
    .eq("id", org.id);
  if (error) return { ok: false, message: `Couldn't change the plan: ${error.message}` };

  await audit(db, admin.id, "set_plan", { orgId: org.id, details: { from: org.plan, to: parsed.data.plan, note: parsed.data.note } });
  revalidateOrg(org.id);
  return { ok: true, message: "Plan changed (manual override)." };
}

export async function clearPlanOverride(formData: FormData): Promise<void> {
  const { admin, db } = await adminContext();
  const id = orgId.safeParse(formData.get("orgId"));
  if (!id.success) return;
  await db
    .from("organizations")
    .update({ plan_manual_override: false, plan_override_note: null, plan_override_at: null, plan_override_by: null })
    .eq("id", id.data);
  await audit(db, admin.id, "clear_plan_override", { orgId: id.data });
  revalidateOrg(id.data);
}

const grantSchema = z.object({
  orgId,
  amount: z.coerce.number().int("Whole credits only.").min(1, "At least 1 credit.").max(100000, "At most 100,000 at a time."),
  note: z.string().trim().max(300).optional(),
});

/** One-off credits for this month: a positive ledger entry with reason "admin_grant". */
export async function grantCredits(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { admin, db } = await adminContext();
  const parsed = grantSchema.safeParse({
    orgId: formData.get("orgId"),
    amount: formData.get("amount"),
    note: formData.get("note") ?? undefined,
  });
  if (!parsed.success) {
    return { ok: false, message: "Check the form.", fieldErrors: { [String(parsed.error.issues[0].path[0])]: parsed.error.issues[0].message } };
  }
  if (!(await orgExists(db, parsed.data.orgId))) return { ok: false, message: "Workspace not found." };

  const { error } = await db.from("ai_credit_ledger").insert({
    org_id: parsed.data.orgId,
    period_start: creditPeriodStart(),
    delta: parsed.data.amount,
    reason: "admin_grant",
  });
  if (error) return { ok: false, message: `Couldn't grant credits: ${error.message}` };

  await audit(db, admin.id, "grant_credits", { orgId: parsed.data.orgId, details: { amount: parsed.data.amount, note: parsed.data.note ?? null } });
  revalidateOrg(parsed.data.orgId);
  return { ok: true, message: `Granted ${parsed.data.amount.toLocaleString()} credits for this month.` };
}

const overrideSchema = z.object({
  orgId,
  value: z.union([
    z.literal("").transform(() => null),
    z.coerce.number().int("Whole credits only.").min(0, "Can't be negative.").max(1_000_000, "Too large."),
  ]),
});

/** Extra monthly credits on top of the plan allowance, every month (organizations.ai_credits_override). */
export async function setCreditOverride(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { admin, db } = await adminContext();
  const parsed = overrideSchema.safeParse({ orgId: formData.get("orgId"), value: String(formData.get("value") ?? "").trim() });
  if (!parsed.success) {
    return { ok: false, message: "Check the form.", fieldErrors: { value: parsed.error.issues[0].message } };
  }
  if (!(await orgExists(db, parsed.data.orgId))) return { ok: false, message: "Workspace not found." };

  const { error } = await db.from("organizations").update({ ai_credits_override: parsed.data.value }).eq("id", parsed.data.orgId);
  if (error) return { ok: false, message: `Couldn't save: ${error.message}` };

  await audit(db, admin.id, "set_credit_override", { orgId: parsed.data.orgId, details: { value: parsed.data.value } });
  revalidateOrg(parsed.data.orgId);
  return {
    ok: true,
    message: parsed.data.value === null ? "Extra monthly credits removed." : `Extra monthly credits set to ${parsed.data.value.toLocaleString()}.`,
  };
}

export async function setUserAdmin(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { admin, db } = await adminContext();
  const userId = z.string().uuid().safeParse(formData.get("userId"));
  const org = orgId.safeParse(formData.get("orgId"));
  const makeAdmin = formData.get("makeAdmin") === "true";
  if (!userId.success) return { ok: false, message: "Unknown user." };
  if (userId.data === admin.id && !makeAdmin) {
    return { ok: false, message: "You can't remove your own admin access. Ask another admin." };
  }

  const { error, count } = await db.from("profiles").update({ is_admin: makeAdmin }, { count: "exact" }).eq("id", userId.data);
  if (error || !count) return { ok: false, message: `Couldn't update the user${error ? `: ${error.message}` : "."}` };

  await audit(db, admin.id, "set_admin", { orgId: org.success ? org.data : null, targetUserId: userId.data, details: { is_admin: makeAdmin } });
  if (org.success) revalidateOrg(org.data);
  return { ok: true, message: makeAdmin ? "Admin access granted." : "Admin access removed." };
}
