"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { appUrl } from "@/lib/account/url";
import type { AuthState } from "@/lib/account/auth-state";

export async function requestPasswordReset(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = z.email("Enter a valid email address.").max(254).safeParse(formData.get("email"));
  if (!parsed.success) return { ok: false, fieldErrors: { email: parsed.error.issues[0]?.message ?? "Enter a valid email address." } };
  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data, {
    redirectTo: `${await appUrl()}/auth/callback?next=${encodeURIComponent("/reset-password")}`,
  });
  if (error && (error.status === 429 || error.code === "over_email_send_rate_limit")) {
    return { ok: false, email: parsed.data, message: "We just sent a reset link. Wait a minute before asking again." };
  }
  // Same message either way so this can't be used to check which emails have accounts.
  return {
    ok: true,
    email: parsed.data,
    message: `If there's an account for ${parsed.data}, we've emailed a link to reset the password. It expires in an hour.`,
  };
}
