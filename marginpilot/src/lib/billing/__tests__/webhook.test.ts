import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { handleStripeWebhook, hasSaleDiscount, type SubscriptionLike, type WebhookDeps } from "../webhook";
import { planFromPriceId, priceIdForPlan } from "../stripe";
import { FakeDb } from "./fake-db";

const SECRET = "whsec_test_secret";
const ENV = {
  STRIPE_PRICE_STARTER_MONTHLY: "price_starter",
  STRIPE_PRICE_PROFESSIONAL_MONTHLY: "price_pro",
  STRIPE_PRICE_MENTORSHIP_MONTHLY: "price_mentor",
} as unknown as NodeJS.ProcessEnv;

const realStripe = new Stripe("sk_test_dummy");
const ORG = "11111111-1111-1111-1111-111111111111";
const OTHER_ORG = "22222222-2222-2222-2222-222222222222";
const USER = "33333333-3333-3333-3333-333333333333";
const NOW = new Date("2026-11-26T12:00:00Z");

function sub(over: Partial<SubscriptionLike> = {}, price = "price_pro"): SubscriptionLike {
  return {
    id: "sub_1",
    customer: "cus_1",
    status: "active",
    metadata: { org_id: ORG, plan: "professional", sale: "true" },
    cancel_at_period_end: false,
    trial_end: null,
    items: { data: [{ price: { id: price }, current_period_end: 1_798_000_000 }] },
    ...over,
  };
}

let db: FakeDb;
let stripeSubs: Record<string, SubscriptionLike>;
let deps: WebhookDeps;
let seq = 0;

function signed(type: string, object: unknown, id = `evt_${++seq}`) {
  const payload = JSON.stringify({ id, object: "event", type, data: { object } });
  const header = realStripe.webhooks.generateTestHeaderString({ payload, secret: SECRET });
  return { payload, header, id };
}

async function send(type: string, object: unknown, id?: string) {
  const e = signed(type, object, id);
  return { ...(await handleStripeWebhook(e.payload, e.header, deps)), id: e.id };
}

beforeEach(() => {
  db = new FakeDb({
    organizations: [
      { id: ORG, name: "Acme", plan: "none", stripe_customer_id: null },
      { id: OTHER_ORG, name: "Other", plan: "starter", stripe_customer_id: "cus_other" },
    ],
  });
  stripeSubs = {};
  deps = {
    db: db as unknown as SupabaseClient,
    stripe: {
      webhooks: realStripe.webhooks,
      subscriptions: {
        retrieve: vi.fn(async (id: string) => {
          if (!stripeSubs[id]) throw Object.assign(new Error("No such subscription"), { code: "resource_missing" });
          return stripeSubs[id];
        }),
      },
    },
    webhookSecret: SECRET,
    planForPrice: (p) => planFromPriceId(p, ENV),
    now: () => NOW,
  };
});

const org = (id = ORG) => db.rows("organizations").find((o) => o.id === id)!;

describe("plan mapping", () => {
  it("maps price ids to plans and back", () => {
    expect(planFromPriceId("price_starter", ENV)).toBe("starter");
    expect(planFromPriceId("price_pro", ENV)).toBe("professional");
    expect(planFromPriceId("price_mentor", ENV)).toBe("mentorship");
    expect(planFromPriceId("price_unknown", ENV)).toBeNull();
    expect(planFromPriceId(null, ENV)).toBeNull();
    expect(priceIdForPlan("mentorship", ENV)).toBe("price_mentor");
  });
  it("ignores unset and placeholder price env vars", () => {
    const env = { STRIPE_PRICE_STARTER_MONTHLY: "price_" } as unknown as NodeJS.ProcessEnv;
    expect(planFromPriceId("price_", env)).toBeNull();
    expect(() => priceIdForPlan("starter", env)).toThrow(/not configured/);
  });
});

describe("signature and idempotency", () => {
  it("rejects a bad signature without touching the database", async () => {
    const e = signed("customer.subscription.updated", sub());
    const res = await handleStripeWebhook(e.payload, e.header.replace(/v1=[0-9a-f]+/, "v1=deadbeef"), deps);
    expect(res.status).toBe(400);
    expect(db.rows("stripe_events")).toHaveLength(0);
  });

  it("rejects a tampered body and a missing header", async () => {
    const e = signed("customer.subscription.updated", sub());
    expect((await handleStripeWebhook(e.payload.replace("active", "trialing"), e.header, deps)).status).toBe(400);
    expect((await handleStripeWebhook(e.payload, null, deps)).status).toBe(400);
  });

  it("records the event and ignores a duplicate delivery", async () => {
    stripeSubs.sub_1 = sub();
    const e = signed("customer.subscription.created", sub());
    const first = await handleStripeWebhook(e.payload, e.header, deps);
    expect(first).toEqual({ status: 200, body: { received: true } });
    expect(db.rows("stripe_events")[0]).toMatchObject({ id: e.id, type: "customer.subscription.created", processed_at: NOW.toISOString() });

    // Change state behind the scenes: a duplicate must not re-apply anything.
    org().plan = "none";
    const second = await handleStripeWebhook(e.payload, e.header, deps);
    expect(second.body.duplicate).toBe(true);
    expect(org().plan).toBe("none");
    expect(deps.stripe.subscriptions.retrieve).toHaveBeenCalledTimes(1);
  });

  it("retries an event whose earlier attempt failed, and returns 500 on failure", async () => {
    stripeSubs.sub_1 = sub();
    db.failOn = { table: "subscriptions", op: "upsert" };
    const e = signed("customer.subscription.updated", sub());
    const failed = await handleStripeWebhook(e.payload, e.header, deps);
    expect(failed.status).toBe(500);
    expect(db.rows("stripe_events")[0].processed_at ?? null).toBeNull();
    expect(String(db.rows("stripe_events")[0].error)).toMatch(/forced failure/);

    db.failOn = null;
    const retried = await handleStripeWebhook(e.payload, e.header, deps);
    expect(retried.status).toBe(200);
    expect(org().plan).toBe("professional");
    expect(db.rows("stripe_events")[0]).toMatchObject({ error: null, processed_at: NOW.toISOString() });
  });

  it("acknowledges unhandled event types", async () => {
    const res = await send("customer.created", { id: "cus_x" });
    expect(res.status).toBe(200);
    expect(res.body.ignored).toBe(true);
  });
});

describe("checkout.session.completed", () => {
  it("subscription mode links the customer to the org and syncs the subscription", async () => {
    stripeSubs.sub_1 = sub({ status: "trialing", trial_end: 1_797_000_000 });
    const res = await send("checkout.session.completed", {
      id: "cs_1",
      mode: "subscription",
      customer: "cus_1",
      subscription: "sub_1",
      client_reference_id: ORG,
      metadata: { org_id: ORG, plan: "professional" },
    });
    expect(res.status).toBe(200);
    expect(org()).toMatchObject({ stripe_customer_id: "cus_1", plan: "professional" });
    expect(db.rows("subscriptions")[0]).toMatchObject({
      id: "sub_1",
      org_id: ORG,
      plan: "professional",
      status: "trialing",
      price_id: "price_pro",
      trial_end: new Date(1_797_000_000 * 1000).toISOString(),
      current_period_end: new Date(1_798_000_000 * 1000).toISOString(),
      sale_discount: true,
    });
  });

  it("payment mode records a course purchase from metadata.user_id, once", async () => {
    const session = {
      id: "cs_course",
      mode: "payment",
      payment_status: "paid",
      customer: null,
      payment_intent: "pi_1",
      metadata: { user_id: USER, product: "course" },
      amount_total: 29700,
      currency: "usd",
    };
    await send("checkout.session.completed", session);
    await send("checkout.session.completed", session); // different event id, same session
    expect(db.rows("course_purchases")).toEqual([
      {
        user_id: USER,
        stripe_checkout_session_id: "cs_course",
        stripe_payment_intent_id: "pi_1",
        amount_cents: 29700,
        currency: "usd",
      },
    ]);
    expect(org().plan).toBe("none");
  });

  it("payment mode without a user id fails so Stripe retries", async () => {
    const res = await send("checkout.session.completed", { id: "cs_x", mode: "payment", customer: null, metadata: {} });
    expect(res.status).toBe(500);
  });
});

describe("customer.subscription.*", () => {
  it("created: upserts the row and sets the org plan", async () => {
    stripeSubs.sub_1 = sub({}, "price_starter");
    await send("customer.subscription.created", sub({}, "price_starter"));
    expect(db.rows("subscriptions")).toHaveLength(1);
    expect(org().plan).toBe("starter");
    // Fills the customer link when checkout.session.completed hasn't arrived yet.
    expect(org().stripe_customer_id).toBe("cus_1");
  });

  it("updated: plan change is applied from the latest Stripe state, not the (stale) payload", async () => {
    stripeSubs.sub_1 = sub({}, "price_mentor");
    await send("customer.subscription.updated", sub({}, "price_starter"));
    expect(db.rows("subscriptions")).toHaveLength(1);
    expect(db.rows("subscriptions")[0]).toMatchObject({ plan: "mentorship", price_id: "price_mentor" });
    expect(org().plan).toBe("mentorship");
  });

  it("finds the org by Stripe customer when metadata has no org id", async () => {
    const s = sub({ id: "sub_o", customer: "cus_other", metadata: {} }, "price_mentor");
    stripeSubs.sub_o = s;
    await send("customer.subscription.updated", s);
    expect(org(OTHER_ORG).plan).toBe("mentorship");
    expect(org().plan).toBe("none");
  });

  it("past_due / unpaid status removes the plan", async () => {
    stripeSubs.sub_1 = sub();
    await send("customer.subscription.created", sub());
    expect(org().plan).toBe("professional");
    stripeSubs.sub_1 = sub({ status: "past_due" });
    await send("customer.subscription.updated", sub({ status: "past_due" }));
    expect(org().plan).toBe("none");
    expect(db.rows("subscriptions")[0].status).toBe("past_due");
  });

  it("cancel_at_period_end keeps the plan until the period ends", async () => {
    stripeSubs.sub_1 = sub({ cancel_at_period_end: true });
    await send("customer.subscription.updated", sub({ cancel_at_period_end: true }));
    expect(org().plan).toBe("professional");
    expect(db.rows("subscriptions")[0].cancel_at_period_end).toBe(true);
  });

  it("deleted: subscription cancelled -> plan none", async () => {
    stripeSubs.sub_1 = sub();
    await send("customer.subscription.created", sub());
    expect(org().plan).toBe("professional");
    delete stripeSubs.sub_1;
    const res = await send("customer.subscription.deleted", sub({ status: "canceled" }));
    expect(res.status).toBe(200);
    expect(db.rows("subscriptions")[0].status).toBe("canceled");
    expect(org().plan).toBe("none");
  });

  it("deleting an old subscription keeps the plan from another live one", async () => {
    stripeSubs.sub_1 = sub();
    stripeSubs.sub_2 = sub({ id: "sub_2" }, "price_starter");
    await send("customer.subscription.created", stripeSubs.sub_1);
    await send("customer.subscription.created", stripeSubs.sub_2);
    expect(org().plan).toBe("professional"); // best of the two
    await send("customer.subscription.deleted", sub({ status: "canceled" }));
    expect(org().plan).toBe("starter");
  });

  it("an unknown price fails loudly instead of granting a plan", async () => {
    stripeSubs.sub_1 = sub({}, "price_mystery");
    const res = await send("customer.subscription.created", sub({}, "price_mystery"));
    expect(res.status).toBe(500);
    expect(org().plan).toBe("none");
  });

  it("falls back to the payload when Stripe no longer has the subscription", async () => {
    const res = await send("customer.subscription.updated", sub({ status: "canceled" }));
    expect(res.status).toBe(200);
    expect(org().plan).toBe("none");
    expect(db.rows("subscriptions")[0].status).toBe("canceled");
  });
});

describe("invoice.payment_failed", () => {
  it("records the failure on the subscription without changing the plan", async () => {
    stripeSubs.sub_1 = sub();
    await send("customer.subscription.created", sub());
    const res = await send("invoice.payment_failed", {
      id: "in_1",
      customer: "cus_1",
      parent: { subscription_details: { subscription: "sub_1" } },
    });
    expect(res.status).toBe(200);
    expect(db.rows("subscriptions")[0]).toMatchObject({ last_payment_failed_at: NOW.toISOString(), last_failed_invoice_id: "in_1" });
    expect(org().plan).toBe("professional");
    expect(db.rows("stripe_events").map((e) => e.type)).toContain("invoice.payment_failed");
  });
});

describe("charge.refunded", () => {
  beforeEach(() => {
    db.rows("course_purchases").push({
      user_id: USER,
      stripe_checkout_session_id: "cs_course",
      stripe_payment_intent_id: "pi_1",
      amount_cents: 29700,
      refunded_at: null,
    });
  });

  it("marks a fully refunded course purchase", async () => {
    await send("charge.refunded", { id: "ch_1", payment_intent: "pi_1", refunded: true });
    expect(db.rows("course_purchases")[0].refunded_at).toBe(NOW.toISOString());
  });

  it("ignores partial refunds and unrelated charges", async () => {
    await send("charge.refunded", { id: "ch_1", payment_intent: "pi_1", refunded: false });
    await send("charge.refunded", { id: "ch_2", payment_intent: "pi_other", refunded: true });
    expect(db.rows("course_purchases")[0].refunded_at).toBeNull();
  });
});

describe("hasSaleDiscount", () => {
  it("reads our checkout metadata or an expanded discount with the sale coupon", () => {
    expect(hasSaleDiscount(sub({ metadata: { sale: "true" } }), "SALE50")).toBe(true);
    expect(hasSaleDiscount(sub({ metadata: {} }), "SALE50")).toBe(false);
    expect(hasSaleDiscount(sub({ metadata: {}, discounts: [{ source: { coupon: "SALE50" } }] }), "SALE50")).toBe(true);
    expect(hasSaleDiscount(sub({ metadata: {}, discounts: [{ coupon: { id: "SALE50" } }] }), "SALE50")).toBe(true);
    expect(hasSaleDiscount(sub({ metadata: {}, discounts: ["di_123"] }), "SALE50")).toBe(false);
  });
});
