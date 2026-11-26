"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { canManage, getAppContext } from "@/lib/auth";
import { assertWithinLimit, PlanLimitError } from "@/lib/limits";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { appUrl } from "@/lib/account/url";
import { fieldErrorsFrom } from "@/lib/account/auth-state";
import { hashInviteToken, inviteExpiry, inviteLink, newInviteToken, sendInviteEmail } from "@/lib/team/invitations";
import type { ActionState } from "@/components/ui/form";

export type InviteState = (NonNullable<ActionState> & { link?: string; emailed?: boolean }) | null;

const inviteSchema = z.object({
  email: z.email("Enter a valid email address.").max(254).transform((e) => e.trim().toLowerCase()),
  role: z.enum(["member", "admin"], { message: "Choose a role." }),
});

export async function inviteMember(_prev: InviteState, formData: FormData): Promise<InviteState> {
  const ctx = await getAppContext();
  if (!canManage(ctx.role)) return { ok: false, message: "Only the workspace owner or an admin can invite people." };

  const parsed = inviteSchema.safeParse({ email: formData.get("email"), role: formData.get("role") });
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsFrom(parsed.error.issues) };
  const { email, role } = parsed.data;
  if (email === ctx.user.email.toLowerCase()) return { ok: false, fieldErrors: { email: "You're already in this workspace." } };

  const admin = createAdminClient();
  const nowIso = new Date().toISOString();
  const { data: pending } = await admin
    .from("invitations")
    .select("email")
    .eq("org_id", ctx.org.id)
    .is("accepted_at", null)
    .gt("expires_at", nowIso);
  const otherPending = (pending ?? []).filter((p) => (p.email as string).toLowerCase() !== email).length;

  try {
    // Pending invitations hold a seat too, so you can't invite past the limit.
    await assertWithinLimit(ctx.org.id, "seats", 1 + otherPending);
  } catch (e) {
    if (e instanceof PlanLimitError) {
      const note = otherPending > 0 ? ` (${otherPending} pending invitation${otherPending === 1 ? "" : "s"} count toward this.)` : "";
      return { ok: false, message: e.message + note };
    }
    throw e;
  }

  // One live invitation per email: replace any earlier one.
  await admin.from("invitations").delete().eq("org_id", ctx.org.id).eq("email", email).is("accepted_at", null);

  const token = newInviteToken();
  const supabase = await createClient(); // RLS: owners/admins may create invitations for their org
  const { error } = await supabase.from("invitations").insert({
    org_id: ctx.org.id,
    email,
    role,
    token_hash: hashInviteToken(token),
    invited_by: ctx.user.id,
    expires_at: inviteExpiry(),
  });
  if (error) {
    console.error("[team] invite insert failed", error.message);
    return { ok: false, message: "We couldn't create the invitation. Please try again." };
  }

  const link = inviteLink(await appUrl(), token);
  const emailed = await sendInviteEmail({ to: email, link, orgName: ctx.org.name, inviterName: ctx.user.fullName || ctx.user.email });
  revalidatePath("/app/team");
  return emailed
    ? { ok: true, emailed, message: `Invitation sent to ${email}. The link works for 7 days.` }
    : { ok: true, emailed, link, message: `Invitation created for ${email}. Copy the link below and send it to them. It works for 7 days and is shown only once.` };
}

export async function revokeInvitation(formData: FormData) {
  const ctx = await getAppContext();
  if (!canManage(ctx.role)) return;
  const id = z.uuid().safeParse(formData.get("invitationId"));
  if (!id.success) return;
  await createAdminClient().from("invitations").delete().eq("id", id.data).eq("org_id", ctx.org.id).is("accepted_at", null);
  revalidatePath("/app/team");
}

export async function removeMember(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getAppContext();
  const parsed = z.uuid().safeParse(formData.get("userId"));
  if (!parsed.success) return { ok: false, message: "Unknown member." };
  const userId = parsed.data;
  const self = userId === ctx.user.id;
  if (!self && !canManage(ctx.role)) return { ok: false, message: "Only the workspace owner or an admin can remove people." };

  const admin = createAdminClient();
  const { data: target } = await admin
    .from("memberships")
    .select("role")
    .eq("org_id", ctx.org.id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!target) return { ok: false, message: "That person isn't in this workspace." };
  if (target.role === "owner") return { ok: false, message: "The workspace owner can't be removed." };
  if (target.role === "admin" && !self && ctx.role !== "owner") return { ok: false, message: "Only the owner can remove an admin." };

  const { error } = await admin.from("memberships").delete().eq("org_id", ctx.org.id).eq("user_id", userId).neq("role", "owner");
  if (error) return { ok: false, message: "We couldn't remove that member. Please try again." };
  await admin
    .from("profiles")
    .update({ current_org_id: null, current_store_id: null })
    .eq("id", userId)
    .eq("current_org_id", ctx.org.id);

  revalidatePath("/app", "layout");
  return { ok: true, message: self ? "You left the workspace." : "Member removed." };
}
