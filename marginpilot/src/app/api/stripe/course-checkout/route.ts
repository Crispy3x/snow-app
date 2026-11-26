import { NextResponse, type NextRequest } from "next/server";
import { getUser } from "@/lib/auth";
import { createCourseCheckout } from "@/lib/billing/checkout";
import { coursePriceId } from "@/lib/billing/stripe";

/** GET /api/stripe/course-checkout: one-time course purchase for the signed-in user. */
export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  const user = await getUser();
  if (!user) {
    const login = new URL("/login", origin);
    login.searchParams.set("next", "/api/stripe/course-checkout");
    return NextResponse.redirect(login, 303);
  }
  if (!coursePriceId()) return NextResponse.redirect(new URL("/app/billing?reason=course", origin), 303);
  try {
    const url = await createCourseCheckout({ id: user.id, email: user.email });
    return NextResponse.redirect(url, 303);
  } catch (e) {
    console.error("course checkout failed", e);
    return NextResponse.redirect(new URL("/app/billing?reason=course&error=checkout_failed", origin), 303);
  }
}
