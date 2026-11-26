"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { fieldErrorsFrom, type AuthState } from "@/lib/account/auth-state";

const schema = z
  .object({
    password: z.string().min(8, "Use at least 8 characters.").max(72, "Use 72 characters or fewer."),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "The passwords don't match." });

export async function resetPassword(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = schema.safeParse({ password: formData.get("password"), confirm: formData.get("confirm") });
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsFrom(parsed.error.issues) };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Your reset link has expired. Ask for a new one." };

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    if (error.code === "same_password") return { ok: false, fieldErrors: { password: "Choose a password you haven't used here before." } };
    if (error.code === "weak_password") return { ok: false, fieldErrors: { password: error.message || "Choose a stronger password." } };
    console.error("[auth] password reset failed", error.code, error.message);
    return { ok: false, message: "We couldn't update your password. Please try again." };
  }
  redirect("/app");
}
