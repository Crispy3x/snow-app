"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { safeNext } from "@/lib/account/redirect";
import { appUrl } from "@/lib/account/url";
import { fieldErrorsFrom, type AuthState } from "@/lib/account/auth-state";

const emailField = z.email("Enter a valid email address.").max(254);

const loginSchema = z.object({
  email: emailField,
  password: z.string().min(1, "Enter your password."),
});

function isRateLimit(error: { status?: number; code?: string }) {
  return error.status === 429 || error.code === "over_request_rate_limit" || error.code === "over_email_send_rate_limit";
}

export async function login(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = loginSchema.safeParse({ email: formData.get("email"), password: formData.get("password") });
  const email = String(formData.get("email") ?? "");
  if (!parsed.success) return { ok: false, email, fieldErrors: fieldErrorsFrom(parsed.error.issues) };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    if (error.code === "email_not_confirmed") {
      return {
        ok: false,
        code: "email_not_confirmed",
        email,
        message: "Your email isn't confirmed yet. Open the link we sent when you signed up, or send a new one below.",
      };
    }
    if (error.code === "invalid_credentials") {
      return { ok: false, email, message: "That email and password don't match. Check for typos, or reset your password." };
    }
    if (isRateLimit(error)) return { ok: false, email, message: "Too many attempts. Wait a minute, then try again." };
    console.error("[auth] login failed", error.code, error.message);
    return { ok: false, email, message: "We couldn't sign you in right now. Please try again." };
  }
  redirect(safeNext(formData.get("next")));
}

export async function sendMagicLink(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = emailField.safeParse(formData.get("email"));
  if (!parsed.success) return { ok: false, fieldErrors: { email: parsed.error.issues[0]?.message ?? "Enter a valid email address." } };
  const next = safeNext(formData.get("next"));
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data,
    options: { shouldCreateUser: false, emailRedirectTo: `${await appUrl()}/auth/callback?next=${encodeURIComponent(next)}` },
  });
  if (error && isRateLimit(error)) {
    return { ok: false, email: parsed.data, message: "We just sent a link. Wait a minute before asking for another." };
  }
  // Same answer whether or not the account exists, so this can't be used to probe for emails.
  return { ok: true, email: parsed.data, message: `If there's an account for ${parsed.data}, a sign-in link is on its way. It works once and expires in an hour.` };
}

export async function resendConfirmation(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = emailField.safeParse(formData.get("email"));
  if (!parsed.success) return { ok: false, message: "Enter your email above first." };
  const next = safeNext(formData.get("next"));
  const supabase = await createClient();
  const { error } = await supabase.auth.resend({
    type: "signup",
    email: parsed.data,
    options: { emailRedirectTo: `${await appUrl()}/auth/callback?next=${encodeURIComponent(next)}` },
  });
  if (error && isRateLimit(error)) return { ok: false, message: "We just sent one. Wait a minute before asking again." };
  return { ok: true, message: `We sent a new confirmation link to ${parsed.data}.` };
}
