import { NextResponse, type NextRequest } from "next/server";
import { getUser } from "@/lib/auth";
import { isPlanKey } from "@/lib/billing/stripe";
import { startPlanForCurrentUser } from "@/lib/billing/start";

/**
 * GET /api/stripe/checkout?plan=starter
 * Lands here after email confirmation (signup with a chosen plan) and from
 * plain links. Sends the user to Stripe Checkout for their current workspace.
 */
export async function GET(request: NextRequest) {
  const plan = request.nextUrl.searchParams.get("plan");
  const billing = new URL("/app/billing", request.nextUrl.origin);
  if (!isPlanKey(plan)) return NextResponse.redirect(billing, 303);

  const user = await getUser();
  if (!user) {
    const login = new URL("/login", request.nextUrl.origin);
    login.searchParams.set("next", `/api/stripe/checkout?plan=${plan}`);
    return NextResponse.redirect(login, 303);
  }

  const result = await startPlanForCurrentUser(plan, { allowChange: false });
  if (result.kind === "redirect") return NextResponse.redirect(result.url, 303);
  if (result.kind === "error") billing.searchParams.set("error", result.code);
  return NextResponse.redirect(billing, 303);
}
