"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getAppContext, requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fieldErrorsFrom } from "@/lib/account/auth-state";
import { cancelOrgSubscriptions } from "@/lib/billing/checkout";
import { isStripeConfigured } from "@/lib/billing/stripe";
import type { ActionState } from "@/components/ui/form";

const name = z.string().trim().min(1, "Enter a name.").max(120, "Use 120 characters or fewer.");

export async function updateProfile(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser("/app/settings");
  const parsed = name.safeParse(formData.get("fullName"));
  if (!parsed.success) return { ok: false, fieldErrors: { fullName: parsed.error.issues[0]!.message } };
  const supabase = await createClient();
  const { error } = await supabase.from("profiles").update({ full_name: parsed.data }).eq("id", user.id);
  if (error) return { ok: false, message: "We couldn't save your name. Please try again." };
  await supabase.auth.updateUser({ data: { full_name: parsed.data } });
  revalidatePath("/app", "layout");
  return { ok: true, message: "Name saved." };
}

const passwordSchema = z
  .object({
    current: z.string().min(1, "Enter your current password."),
    password: z.string().min(8, "Use at least 8 characters.").max(72, "Use 72 characters or fewer."),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "The passwords don't match." });

export async function changePassword(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser("/app/settings");
  const parsed = passwordSchema.safeParse({
    current: formData.get("current"),
    password: formData.get("password"),
    confirm: formData.get("confirm"),
  });
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsFrom(parsed.error.issues) };

  const supabase = await createClient();
  // Re-check the current password so a borrowed, signed-in browser can't lock the owner out.
  const { error: authError } = await supabase.auth.signInWithPassword({ email: user.email, password: parsed.data.current });
  if (authError) {
    if (authError.status === 429) return { ok: false, message: "Too many attempts. Wait a minute, then try again." };
    return { ok: false, fieldErrors: { current: "That isn't your current password." } };
  }
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    if (error.code === "same_password") return { ok: false, fieldErrors: { password: "Choose a different password from your current one." } };
    if (error.code === "weak_password") return { ok: false, fieldErrors: { password: error.message || "Choose a stronger password." } };
    return { ok: false, message: "We couldn't change your password. Please try again." };
  }
  return { ok: true, message: "Password changed." };
}

export async function renameWorkspace(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getAppContext();
  if (ctx.role !== "owner") return { ok: false, message: "Only the workspace owner can rename it." };
  const parsed = name.safeParse(formData.get("workspaceName"));
  if (!parsed.success) return { ok: false, fieldErrors: { workspaceName: parsed.error.issues[0]!.message } };
  const supabase = await createClient(); // RLS: only the owner may update
  const { data, error } = await supabase.from("organizations").update({ name: parsed.data }).eq("id", ctx.org.id).select("id");
  if (error || !data?.length) return { ok: false, message: "We couldn't rename the workspace. Please try again." };
  revalidatePath("/app", "layout");
  return { ok: true, message: "Workspace renamed." };
}

export async function deleteAccount(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser("/app/settings");
  if (String(formData.get("confirm") ?? "").trim() !== "DELETE") {
    return { ok: false, fieldErrors: { confirm: "Type DELETE in capital letters to confirm." } };
  }

  const admin = createAdminClient();
  const { data: owned, error: ownedError } = await admin.from("organizations").select("id").eq("owner_id", user.id);
  if (ownedError) return { ok: false, message: "We couldn't delete your account. Please try again." };

  try {
    // Stop billing first: if Stripe can't be reached we stop here and nothing is deleted.
    for (const org of owned ?? []) {
      if (isStripeConfigured()) await cancelOrgSubscriptions(org.id as string);
    }
  } catch (e) {
    console.error("[account] cancel subscriptions failed", e);
    return { ok: false, message: "We couldn't cancel your subscription with our payment provider, so nothing was deleted. Please try again or contact support." };
  }

  // Workspaces you own are deleted with everything in them (stores, listings, team access).
  if (owned?.length) {
    const { error } = await admin.from("organizations").delete().in("id", owned.map((o) => o.id as string));
    if (error) {
      console.error("[account] delete organizations failed", error.message);
      return { ok: false, message: "Your subscription was cancelled but we couldn't finish deleting your data. Please contact support." };
    }
  }

  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) {
    console.error("[account] delete auth user failed", error.message);
    return { ok: false, message: "Your workspace was deleted but we couldn't remove your login. Please contact support." };
  }

  const supabase = await createClient();
  await supabase.auth.signOut().catch(() => undefined);
  redirect("/?account=deleted");
}
