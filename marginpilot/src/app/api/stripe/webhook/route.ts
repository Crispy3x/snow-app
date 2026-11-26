import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe, planFromPriceId } from "@/lib/billing/stripe";
import { handleStripeWebhook } from "@/lib/billing/webhook";

/**
 * Stripe webhook endpoint. Point Stripe at /api/stripe/webhook and subscribe to:
 * checkout.session.completed, checkout.session.async_payment_succeeded,
 * customer.subscription.created/updated/deleted/paused/resumed,
 * invoice.payment_failed, charge.refunded.
 * The signature is checked against the raw body, so read it as text.
 */
export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ error: "Stripe webhook is not configured" }, { status: 500 });
  }
  const rawBody = await request.text();
  const result = await handleStripeWebhook(rawBody, request.headers.get("stripe-signature"), {
    db: createAdminClient(),
    stripe: getStripe(),
    webhookSecret: secret,
    planForPrice: (priceId) => planFromPriceId(priceId),
  });
  return NextResponse.json(result.body, { status: result.status });
}
