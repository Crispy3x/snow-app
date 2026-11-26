"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { assertWithinLimit, PlanLimitError } from "@/lib/limits";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashInviteToken, invitationProblem } from "@/lib/team/invitations";
import type { ActionState } from "@/components/ui/form";
import { PROBLEM_TEXT } from "./problems";

export async function acceptInvitation(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const token = String(formData.get("token") ?? "");
  const user = await requireUser(`/auth/invite?token=${encodeURIComponent(token)}`);
  if (!token) return { ok: false, message: PROBLEM_TEXT.not_found };

  const admin = createAdminClient();
  const { data: inv } = await admin
    .from("invitations")
    .select("id, org_id, email, role, expires_at, accepted_at")
    .eq("token_hash", hashInviteToken(token))
    .maybeSingle();
  const problem = invitationProblem(inv, user.email);
  if (problem || !inv) return { ok: false, message: PROBLEM_TEXT[problem ?? "not_found"] };

  const { data: existing } = await admin
    .from("memberships")
    .select("role")
    .eq("org_id", inv.org_id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!existing) {
    try {
      await assertWithinLimit(inv.org_id as string, "seats", 1);
    } catch (e) {
      if (e instanceof PlanLimitError) {
        return { ok: false, message: "This workspace has no free seats right now. Ask the person who invited you to upgrade or free a seat." };
      }
      throw e;
    }
    const { error } = await admin.from("memberships").insert({ org_id: inv.org_id, user_id: user.id, role: inv.role });
    if (error && error.code !== "23505") {
      console.error("[team] accept invite failed", error.message);
      return { ok: false, message: "We couldn't add you to the workspace. Please try again." };
    }
  }

  // Mark used only if still unused, so one link can't be redeemed twice in a race.
  await admin.from("invitations").update({ accepted_at: new Date().toISOString() }).eq("id", inv.id).is("accepted_at", null);
  await admin.from("profiles").update({ current_org_id: inv.org_id, current_store_id: null }).eq("id", user.id);
  redirect("/app");
}
