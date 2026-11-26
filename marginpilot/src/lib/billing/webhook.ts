import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlanKey } from "@/config/plans";

/**
 * Stripe webhook handler: the only writer of billing state.
 * Dependencies are injected (db, stripe, secret, price mapping) so the whole
 * flow is unit-tested with an in-memory database and a fake Stripe.
 *
 * Idempotency: the event id is inserted into stripe_events first. A duplicate
 * whose processed_at is set is acknowledged and skipped. A duplicate that never
 * finished (an earlier attempt threw) is processed again, which is safe because
 * every write below is an upsert or a conditional update.
 */

type StripeEventLike = { id: string; type: string; data: { object: unknown } };

export type WebhookStripe = {
  webhooks: { constructEvent(payload: string, header: string, secret: string): StripeEventLike };
  subscriptions: { retrieve(id: string): Promise<unknown> };
};

export type WebhookDeps = {
  db: SupabaseClient;
  stripe: WebhookStripe;
  webhookSecret: string;
  planForPrice: (priceId: string | null | undefined) => PlanKey | null;
  now?: () => Date;
};

export type WebhookResult = { status: number; body: { received?: boolean; duplicate?: boolean; ignored?: boolean; error?: string } };

// Minimal shapes of the Stripe objects we read (subset of the SDK types).
type Expandable = string | { id: string } | null | undefined;
type Metadata = Record<string, string> | null | undefined;

export type SubscriptionLike = {
  id: string;
  customer: Expandable;
  status: string;
  metadata?: Metadata;
  cancel_at_period_end?: boolean;
  trial_end?: number | null;
  current_period_end?: number | null; // pre-2025 API versions
  items: { data: Array<{ price: { id: string }; current_period_end?: number | null }> };
  discounts?: Array<string | { source?: { coupon?: Expandable }; coupon?: Expandable }> | null;
};

type CheckoutSessionLike = {
  id: string;
  mode: "payment" | "subscription" | "setup" | string;
  customer: Expandable;
  subscription?: Expandable;
  payment_intent?: Expandable;
  client_reference_id?: string | null;
  metadata?: Metadata;
  amount_total?: number | null;
  currency?: string | null;
  payment_status?: string;
};

type InvoiceLike = {
  id: string;
  customer: Expandable;
  subscription?: Expandable; // older API versions
  parent?: { subscription_details?: { subscription?: Expandable } | null } | null;
};

type ChargeLike = { id: string; payment_intent: Expandable; refunded: boolean };

const PLAN_GRANTING = new Set(["active", "trialing"]);
const PLAN_RANK: Record<PlanKey, number> = { starter: 1, professional: 2, mentorship: 3 };
const SUB_STATUSES = new Set(["trialing", "active", "past_due", "canceled", "incomplete", "incomplete_expired", "unpaid", "paused"]);

export const idOf = (v: Expandable): string | null => (v == null ? null : typeof v === "string" ? v : v.id);
const ts = (secs: number | null | undefined) => (secs ? new Date(secs * 1000).toISOString() : null);

function check<T extends { error: { message: string } | null }>(res: T, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res;
}

export async function handleStripeWebhook(rawBody: string, signature: string | null, deps: WebhookDeps): Promise<WebhookResult> {
  if (!signature) return { status: 400, body: { error: "Missing Stripe-Signature header" } };
  let event: StripeEventLike;
  try {
    event = deps.stripe.webhooks.constructEvent(rawBody, signature, deps.webhookSecret);
  } catch {
    return { status: 400, body: { error: "Invalid signature" } };
  }

  const { db } = deps;
  const now = () => (deps.now ? deps.now() : new Date()).toISOString();

  const claim = await db.from("stripe_events").insert({ id: event.id, type: event.type });
  if (claim.error) {
    if (claim.error.code !== "23505") return { status: 500, body: { error: "Could not record event" } };
    const { data: prior } = await db.from("stripe_events").select("processed_at").eq("id", event.id).maybeSingle();
    if (prior?.processed_at) return { status: 200, body: { received: true, duplicate: true } };
  }

  try {
    const handled = await dispatch(event, deps);
    check(await db.from("stripe_events").update({ processed_at: now(), error: null }).eq("id", event.id), "mark processed");
    return { status: 200, body: handled ? { received: true } : { received: true, ignored: true } };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await db.from("stripe_events").update({ error: message.slice(0, 1000) }).eq("id", event.id);
    console.error(`[stripe webhook] ${event.type} ${event.id} failed:`, message);
    return { status: 500, body: { error: "Processing failed" } }; // Stripe retries
  }
}

async function dispatch(event: StripeEventLike, deps: WebhookDeps): Promise<boolean> {
  const obj = event.data.object;
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
      await onCheckoutCompleted(obj as CheckoutSessionLike, deps);
      return true;
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.paused":
    case "customer.subscription.resumed": {
      // Re-read the latest state so out-of-order deliveries can't roll it back.
      const sub = obj as SubscriptionLike;
      let latest = sub;
      try {
        latest = ((await deps.stripe.subscriptions.retrieve(sub.id)) as SubscriptionLike | null) ?? sub;
      } catch {
        // Fall back to the payload (e.g. the subscription was deleted meanwhile; .deleted will follow).
      }
      await syncSubscription(latest, deps);
      return true;
    }
    case "customer.subscription.deleted":
      await syncSubscription({ ...(obj as SubscriptionLike), status: "canceled" }, deps);
      return true;
    case "invoice.payment_failed":
      await onPaymentFailed(obj as InvoiceLike, deps);
      return true;
    case "charge.refunded":
      await onChargeRefunded(obj as ChargeLike, deps);
      return true;
    default:
      return false;
  }
}

async function onCheckoutCompleted(session: CheckoutSessionLike, deps: WebhookDeps) {
  const { db } = deps;
  const customerId = idOf(session.customer);

  if (session.mode === "payment") {
    const userId = session.metadata?.user_id;
    if (!userId) throw new Error(`checkout ${session.id}: payment without metadata.user_id`);
    if (session.payment_status && session.payment_status !== "paid") return; // async payment: wait for async_payment_succeeded
    check(
      await db.from("course_purchases").upsert(
        {
          user_id: userId,
          stripe_checkout_session_id: session.id,
          stripe_payment_intent_id: idOf(session.payment_intent),
          amount_cents: session.amount_total ?? 0,
          currency: session.currency ?? "usd",
        },
        { onConflict: "stripe_checkout_session_id", ignoreDuplicates: true },
      ),
      "insert course purchase",
    );
    return;
  }

  if (session.mode !== "subscription") return;
  const orgId = session.client_reference_id ?? session.metadata?.org_id;
  if (!orgId) throw new Error(`checkout ${session.id}: no org id`);
  if (customerId) {
    check(await db.from("organizations").update({ stripe_customer_id: customerId }).eq("id", orgId), "link customer");
  }
  const subId = idOf(session.subscription);
  if (subId) {
    const sub = (await deps.stripe.subscriptions.retrieve(subId)) as SubscriptionLike;
    if (sub) await syncSubscription(sub, deps, orgId);
  }
}

async function resolveOrgId(sub: SubscriptionLike, deps: WebhookDeps, hint?: string): Promise<string | null> {
  if (hint) return hint;
  if (sub.metadata?.org_id) return sub.metadata.org_id;
  const customerId = idOf(sub.customer);
  if (!customerId) return null;
  const { data } = await deps.db.from("organizations").select("id").eq("stripe_customer_id", customerId).maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

/** True when the subscription carries the sale coupon (metadata from our checkout, or an expanded discount). */
export function hasSaleDiscount(sub: SubscriptionLike, saleCoupon = process.env.STRIPE_COUPON_SALE): boolean {
  if (sub.metadata?.sale === "true") return true;
  if (!saleCoupon) return false;
  return (sub.discounts ?? []).some((d) => typeof d !== "string" && (idOf(d.source?.coupon) === saleCoupon || idOf(d.coupon) === saleCoupon));
}

export async function syncSubscription(sub: SubscriptionLike, deps: WebhookDeps, orgHint?: string) {
  const { db } = deps;
  const orgId = await resolveOrgId(sub, deps, orgHint);
  if (!orgId) throw new Error(`subscription ${sub.id}: cannot find organization`);

  const item = sub.items?.data?.[0];
  const priceId = item?.price?.id ?? "";
  // Never trust metadata for the plan: the price is what the customer pays for.
  const plan = deps.planForPrice(priceId);
  if (!plan) throw new Error(`subscription ${sub.id}: unknown price ${priceId}`);
  const status = SUB_STATUSES.has(sub.status) ? sub.status : "incomplete";

  check(
    await db.from("subscriptions").upsert(
      {
        id: sub.id,
        org_id: orgId,
        plan,
        status,
        price_id: priceId,
        current_period_end: ts(item?.current_period_end ?? sub.current_period_end),
        cancel_at_period_end: !!sub.cancel_at_period_end,
        trial_end: ts(sub.trial_end),
        sale_discount: hasSaleDiscount(sub),
        updated_at: (deps.now ? deps.now() : new Date()).toISOString(),
      },
      { onConflict: "id" },
    ),
    "upsert subscription",
  );

  const customerId = idOf(sub.customer);
  if (customerId) {
    // Fills the link if checkout.session.completed hasn't arrived yet; never overwrites another customer.
    await db.from("organizations").update({ stripe_customer_id: customerId }).eq("id", orgId).is("stripe_customer_id", null);
  }
  await recomputeOrgPlan(orgId, deps);
}

/** organizations.plan = best plan among active/trialing subscriptions, else 'none'. */
export async function recomputeOrgPlan(orgId: string, deps: WebhookDeps) {
  const { data } = check(await deps.db.from("subscriptions").select("plan, status").eq("org_id", orgId), "read subscriptions");
  let best: PlanKey | "none" = "none";
  for (const row of (data ?? []) as { plan: PlanKey; status: string }[]) {
    if (!PLAN_GRANTING.has(row.status)) continue;
    if (best === "none" || PLAN_RANK[row.plan] > PLAN_RANK[best]) best = row.plan;
  }
  // An admin's manual plan override (admin area) wins until it's cleared there.
  const { data: org } = await deps.db.from("organizations").select("plan_manual_override").eq("id", orgId).maybeSingle();
  if ((org as { plan_manual_override?: boolean } | null)?.plan_manual_override) return;
  check(await deps.db.from("organizations").update({ plan: best }).eq("id", orgId), "set org plan");
}

async function onPaymentFailed(invoice: InvoiceLike, deps: WebhookDeps) {
  // The event itself is kept in stripe_events; the status change arrives via customer.subscription.updated.
  const subId = idOf(invoice.parent?.subscription_details?.subscription) ?? idOf(invoice.subscription);
  if (!subId) return;
  check(
    await deps.db
      .from("subscriptions")
      .update({ last_payment_failed_at: (deps.now ? deps.now() : new Date()).toISOString(), last_failed_invoice_id: invoice.id })
      .eq("id", subId),
    "record payment failure",
  );
}

async function onChargeRefunded(charge: ChargeLike, deps: WebhookDeps) {
  if (!charge.refunded) return; // partial refund: access stays
  const pi = idOf(charge.payment_intent);
  if (!pi) return;
  check(
    await deps.db
      .from("course_purchases")
      .update({ refunded_at: (deps.now ? deps.now() : new Date()).toISOString() })
      .eq("stripe_payment_intent_id", pi)
      .is("refunded_at", null),
    "mark refund",
  );
}
