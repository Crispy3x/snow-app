"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { safeNext } from "@/lib/account/redirect";
import { appUrl } from "@/lib/account/url";
import { fieldErrorsFrom, type AuthState } from "@/lib/account/auth-state";
import { createSubscriptionCheckout } from "@/lib/billing/checkout";
import { attachSignupReferral } from "@/lib/referrals/signup";

const schema = z.object({
  fullName: z.string().trim().min(1, "Enter your name.").max(120, "Use 120 characters or fewer."),
  email: z.email("Enter a valid email address.").max(254),
  password: z
    .string()
    .min(8, "Use at least 8 characters.")
    .max(72, "Use 72 characters or fewer."),
  plan: z.enum(["starter", "professional", "mentorship", ""]).optional(),
});

export async function signup(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get("email") ?? "");
  const parsed = schema.safeParse({
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    password: formData.get("password"),
    plan: formData.get("plan") ?? "",
  });
  if (!parsed.success) return { ok: false, email, fieldErrors: fieldErrorsFrom(parsed.error.issues) };
  const { fullName, password } = parsed.data;
  const plan = parsed.data.plan || null;

  const rawNext = formData.get("next");
  const hasNext = typeof rawNext === "string" && rawNext.length > 0;
  // Where to go once signed in: an explicit next (e.g. an invitation), else checkout for the chosen plan, else billing.
  const after = hasNext ? safeNext(rawNext) : plan ? `/api/stripe/checkout?plan=${plan}` : "/app/billing";

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password,
    options: {
      data: { full_name: fullName },
      emailRedirectTo: `${await appUrl()}/auth/callback?next=${encodeURIComponent(after)}`,
    },
  });

  if (error) {
    if (error.code === "user_already_exists" || error.code === "email_exists") {
      return { ok: false, email, code: "exists", message: "An account with this email already exists. Log in instead." };
    }
    if (error.code === "weak_password") {
      return { ok: false, email, fieldErrors: { password: error.message || "Choose a stronger password." } };
    }
    if (error.code === "email_address_invalid") return { ok: false, email, fieldErrors: { email: "We can't send email to that address." } };
    if (error.status === 429 || error.code === "over_email_send_rate_limit" || error.code === "over_request_rate_limit") {
      return { ok: false, email, message: "Too many sign-up attempts. Wait a minute, then try again." };
    }
    if (error.code === "signup_disabled") return { ok: false, email, message: "New sign-ups are paused right now. Please contact support." };
    console.error("[auth] signup failed", error.code, error.message);
    return { ok: false, email, message: "We couldn't create your account right now. Please try again." };
  }

  // With email confirmation on, Supabase hides existing accounts by returning a user with no identities.
  if (data.user && data.user.identities && data.user.identities.length === 0) {
    return { ok: false, email, code: "exists", message: "An account with this email already exists. Log in instead." };
  }

  // Referral from the mp_ref cookie (set by proxy.ts from ?ref=). Never blocks sign-up.
  if (data.user) await attachSignupReferral({ userId: data.user.id, email: data.user.email ?? parsed.data.email, fullName });

  if (!data.session || !data.user) {
    return {
      ok: true,
      code: "confirm",
      email,
      message: plan
        ? `Check your inbox at ${email}. Click the link to confirm your email and we'll take you straight to checkout.`
        : `Check your inbox at ${email}. Click the link to confirm your email and you're in.`,
    };
  }

  if (hasNext || !plan) redirect(after);

  // Signed in immediately: open Stripe Checkout for the workspace the signup trigger just created.
  let checkoutUrl: string | null = null;
  try {
    const { data: org } = await createAdminClient()
      .from("organizations")
      .select("id")
      .eq("owner_id", data.user.id)
      .order("created_at")
      .limit(1)
      .maybeSingle();
    if (org) checkoutUrl = await createSubscriptionCheckout(org.id as string, plan, { id: data.user.id, email: data.user.email ?? email });
  } catch (e) {
    console.error("[billing] checkout after signup failed", e);
  }
  redirect(checkoutUrl ?? "/app/billing?error=stripe");
}
