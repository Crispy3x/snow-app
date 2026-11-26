import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { safeNext } from "@/lib/account/redirect";

/**
 * Supabase email links land here: magic-link sign-in, signup confirmation,
 * password recovery and email change. Handles both the PKCE `code` flow and
 * the `token_hash` + `type` flow (custom email templates), sets the session
 * cookie, then sends the user on to ?next= (same-site paths only).
 */
const OTP_TYPES = new Set<EmailOtpType>(["signup", "invite", "magiclink", "recovery", "email_change", "email"]);

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const type = params.get("type") as EmailOtpType | null;
  const fallback = type === "recovery" ? "/reset-password" : "/app";
  const next = safeNext(params.get("next"), fallback);
  const origin = request.nextUrl.origin;

  const supabase = await createClient();
  const code = params.get("code");
  const tokenHash = params.get("token_hash");

  let ok = false;
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    ok = !error;
  } else if (tokenHash && type && OTP_TYPES.has(type)) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    ok = !error;
  }

  if (!ok) {
    // Supabase may also redirect here with ?error_description=... for expired links.
    const login = new URL("/login", origin);
    login.searchParams.set("error", "link_invalid");
    if (next !== "/app") login.searchParams.set("next", next);
    return NextResponse.redirect(login, 303);
  }
  return NextResponse.redirect(new URL(next, origin), 303);
}
