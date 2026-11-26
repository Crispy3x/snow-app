import "server-only";
import type Stripe from "stripe";
import { isSaleActive, type PlanKey } from "@/config/plans";
import { appUrl } from "@/lib/account/url";
import { createAdminClient } from "@/lib/supabase/admin";
import { referralCodeForOrg } from "@/lib/referrals/server";
import { coursePriceId, getStripe, priceIdForPlan, saleCouponId, trialDays } from "./stripe";

/**
 * Stripe Checkout, plan changes and the Customer Portal. Callers must have
 * already checked that the user may manage billing for `orgId`
 * (owner/admin via getAppContext + canManage). Billing state in our database
 * is written only by the webhook; the one exception is linking the Stripe
 * customer id to the organization the moment we create the customer.
 */

export type BillingUser = { id: string; email: string };

const LIVE_STATUSES = ["active", "trialing", "past_due", "unpaid", "incomplete", "paused"];

/** Reuses organizations.stripe_customer_id or creates the customer and stores it. */
export async function ensureStripeCustomer(orgId: string, user: BillingUser): Promise<string> {
  const db = createAdminClient();
  const { data: org, error } = await db
    .from("organizations")
    .select("id, name, stripe_customer_id")
    .eq("id", orgId)
    .single();
  if (error || !org) throw new Error("Workspace not found");
  if (org.stripe_customer_id) return org.stripe_customer_id as string;

  const customer = await getStripe().customers.create({
    email: user.email,
    name: org.name as string,
    metadata: { org_id: orgId, created_by: user.id },
  });
  // Only set it if nobody beat us to it; re-read so concurrent requests agree on one customer.
  await db.from("organizations").update({ stripe_customer_id: customer.id }).eq("id", orgId).is("stripe_customer_id", null);
  const { data: after } = await db.from("organizations").select("stripe_customer_id").eq("id", orgId).single();
  return (after?.stripe_customer_id as string | null) ?? customer.id;
}

/** True if the org ever had a subscription (no second free trial). */
async function hadSubscription(orgId: string): Promise<boolean> {
  const db = createAdminClient();
  const { count } = await db.from("subscriptions").select("id", { count: "exact", head: true }).eq("org_id", orgId);
  return (count ?? 0) > 0;
}

/** The org's current non-cancelled subscription, if any (from our webhook-maintained table). */
export async function liveSubscription(orgId: string) {
  const db = createAdminClient();
  const { data } = await db
    .from("subscriptions")
    .select("id, plan, status, price_id, current_period_end, cancel_at_period_end, trial_end, sale_discount")
    .eq("org_id", orgId)
    .in("status", LIVE_STATUSES)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

/**
 * Builds the Checkout Session parameters. Exported for tests: subscription
 * mode, trial for first-time subscribers, org id + plan on the session and
 * the subscription, and the forever 50%-off sale coupon while the sale is on.
 */
export function buildSubscriptionCheckoutParams(input: {
  orgId: string;
  plan: PlanKey;
  userId: string;
  customerId: string;
  priceId: string;
  baseUrl: string;
  trialDays: number;
  saleCoupon: string | undefined;
  now: Date;
  /** Referral code the workspace signed up with (src/lib/referrals); carried on the session and subscription. */
  referralCode?: string;
}): Stripe.Checkout.SessionCreateParams {
  const sale = isSaleActive(input.now) && !!input.saleCoupon;
  const meta: Record<string, string> = { org_id: input.orgId, plan: input.plan, user_id: input.userId, sale: sale ? "true" : "false" };
  if (input.referralCode) meta.referral_code = input.referralCode;
  return {
    mode: "subscription",
    customer: input.customerId,
    client_reference_id: input.orgId,
    line_items: [{ price: input.priceId, quantity: 1 }],
    metadata: meta,
    subscription_data: {
      metadata: meta,
      ...(input.trialDays > 0 ? { trial_period_days: input.trialDays } : {}),
    },
    ...(sale ? { discounts: [{ coupon: input.saleCoupon! }] } : {}),
    customer_update: { name: "auto", address: "auto" },
    billing_address_collection: "auto",
    success_url: `${input.baseUrl}/app/billing?checkout=success`,
    cancel_url: `${input.baseUrl}/app/billing?checkout=cancelled`,
  };
}

export async function createSubscriptionCheckout(orgId: string, plan: PlanKey, user: BillingUser): Promise<string> {
  const priceId = priceIdForPlan(plan);
  const customerId = await ensureStripeCustomer(orgId, user);
  const referralCode = await referralCodeForOrg(createAdminClient(), orgId).catch(() => undefined);
  const params = buildSubscriptionCheckoutParams({
    orgId,
    plan,
    userId: user.id,
    customerId,
    priceId,
    baseUrl: await appUrl(),
    trialDays: (await hadSubscription(orgId)) ? 0 : trialDays(),
    saleCoupon: saleCouponId(),
    now: new Date(),
    referralCode,
  });
  if (isSaleActive(new Date()) && !saleCouponId()) {
    console.warn("[billing] Sale is active but STRIPE_COUPON_SALE is not set; checkout created without the discount");
  }
  const session = await getStripe().checkout.sessions.create(params);
  if (!session.url) throw new Error("Stripe did not return a checkout URL");
  return session.url;
}

/**
 * Switches an existing subscription to another plan in place (keeps the
 * subscription and any forever sale coupon; prorates). Returns false when
 * there is no live subscription, so the caller can fall back to Checkout.
 */
export async function changeSubscriptionPlan(orgId: string, plan: PlanKey): Promise<boolean> {
  const live = await liveSubscription(orgId);
  if (!live || live.status === "incomplete") return false;
  const stripe = getStripe();
  const sub = await stripe.subscriptions.retrieve(live.id as string);
  const item = sub.items.data[0];
  if (!item) return false;
  await stripe.subscriptions.update(sub.id, {
    items: [{ id: item.id, price: priceIdForPlan(plan) }],
    proration_behavior: "create_prorations",
    cancel_at_period_end: false,
    metadata: { ...sub.metadata, plan },
  });
  return true;
}

export async function createPortalSession(orgId: string, user: BillingUser): Promise<string> {
  const customer = await ensureStripeCustomer(orgId, user);
  const session = await getStripe().billingPortal.sessions.create({
    customer,
    return_url: `${await appUrl()}/app/billing`,
  });
  return session.url;
}

/**
 * One-time course purchase (optional product). The webhook records it in
 * course_purchases using metadata.user_id. Not tied to an organization.
 */
export async function createCourseCheckout(user: BillingUser, returnPath = "/app/course"): Promise<string> {
  const price = coursePriceId();
  if (!price) throw new Error("Course price is not configured (STRIPE_PRICE_COURSE_ONE_TIME)");
  const base = await appUrl();
  const session = await getStripe().checkout.sessions.create({
    mode: "payment",
    customer_email: user.email,
    client_reference_id: user.id,
    line_items: [{ price, quantity: 1 }],
    metadata: { user_id: user.id, product: "course" },
    payment_intent_data: { metadata: { user_id: user.id, product: "course" } },
    success_url: `${base}${returnPath}?purchase=success`,
    cancel_url: `${base}${returnPath}?purchase=cancelled`,
  });
  if (!session.url) throw new Error("Stripe did not return a checkout URL");
  return session.url;
}

/** Cancels every live Stripe subscription of the org immediately (account deletion). */
export async function cancelOrgSubscriptions(orgId: string): Promise<void> {
  const db = createAdminClient();
  const { data } = await db.from("subscriptions").select("id").eq("org_id", orgId).in("status", LIVE_STATUSES);
  if (!data?.length) return;
  const stripe = getStripe();
  for (const row of data) {
    try {
      await stripe.subscriptions.cancel(row.id as string);
    } catch (e) {
      // Already cancelled in Stripe is fine; anything else should stop the deletion.
      const code = (e as { code?: string }).code;
      if (code !== "resource_missing") throw e;
    }
  }
}
