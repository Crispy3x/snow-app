import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import { REF_COOKIE, REF_COOKIE_MAX_AGE, refCookieToSet } from "@/lib/referrals/code";
import { recordReferralClick } from "@/lib/referrals/click";
import { isDemoMode } from "@/lib/supabase/demo/mode";

/**
 * Refreshes the Supabase session cookie and keeps signed-out visitors out of
 * /app and /admin. Fine-grained checks (admin role, plan) happen in the server
 * code itself, never only here.
 *
 * Referrals: on any page opened with ?ref=CODE (see the second matcher entry),
 * sets the first-touch mp_ref cookie and counts one visit in the background.
 * Marketing pages are only matched when ?ref= is present, skip the session
 * refresh, and are never redirected, so they stay statically prerendered.
 */
const SESSION_PATHS = /^\/(?:app|admin|auth)(?:\/|$)|^\/(?:login|signup|forgot-password|reset-password)$/;

export async function proxy(request: NextRequest, event: NextFetchEvent) {
  const path = request.nextUrl.pathname;
  const response = SESSION_PATHS.test(path) ? await sessionResponse(request, path) : NextResponse.next({ request });

  const ref = refCookieToSet(request.cookies.get(REF_COOKIE)?.value, request.nextUrl.searchParams.get("ref"));
  if (ref) {
    response.cookies.set(REF_COOKIE, ref, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: REF_COOKIE_MAX_AGE,
      path: "/",
    });
    event.waitUntil(recordReferralClick(ref));
  }
  return response;
}

async function sessionResponse(request: NextRequest, path: string): Promise<NextResponse> {
  let response = NextResponse.next({ request });
  if (isDemoMode()) return response; // demo mode: always signed in as the demo user
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return response;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && (path.startsWith("/app") || path.startsWith("/admin"))) {
    const login = request.nextUrl.clone();
    login.pathname = "/login";
    login.search = `?next=${encodeURIComponent(path + request.nextUrl.search)}`;
    return NextResponse.redirect(login);
  }
  return response;
}

export const config = {
  matcher: [
    "/app/:path*",
    "/admin/:path*",
    "/login",
    "/signup",
    "/forgot-password",
    "/reset-password",
    "/auth/:path*",
    // Any page opened from a referral link (?ref=CODE): cookie only, no session work.
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)",
      has: [{ type: "query", key: "ref" }],
    },
  ],
};
