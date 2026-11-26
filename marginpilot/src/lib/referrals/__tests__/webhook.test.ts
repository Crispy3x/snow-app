import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { handleStripeWebhook, type WebhookDeps } from "../../billing/webhook";
import { planFromPriceId } from "../../billing/stripe";
import { buildSubscriptionCheckoutParams } from "../../billing/checkout";
import { FakeDb } from "../../billing/__tests__/fake-db";

/** End-to-end through the real webhook handler with the in-memory db. */

const SECRET = "whsec_test_secret";
const realStripe = new Stripe("sk_test_dummy");
const ORG = "11111111-1111-1111-1111-111111111111";
const REFERRER = "33333333-3333-3333-3333-333333333333";
const REFERRED = "44444444-4444-4444-4444-444444444444";
const NOW = new Date("2026-11-26T12:00:00Z");
const PAID_AT = Math.floor(Date.parse("2026-11-26T11:00:00Z") / 1000);

let db: FakeDb;
let deps: WebhookDeps;
let now = NOW;
let seq = 0;

async function send(type: string, object: unknown) {
  const payload = JSON.stringify({ id: `evt_r${++seq}`, object: "event", type, data: { object } });
  const header = realStripe.webhooks.generateTestHeaderString({ payload, secret: SECRET });
  return handleStripeWebhook(payload, header, deps);
}

function invoice(over: Record<string, unknown> = {}) {
  return {
    id: "in_1",
    customer: "cus_1",
    amount_paid: 24700,
    currency: "usd",
    status_transitions: { paid_at: PAID_AT },
    payments: { data: [{ payment: { type: "payment_intent", payment_intent: "pi_1" } }] },
    parent: { subscription_details: { subscription: "sub_1", metadata: { org_id: ORG, user_id: REFERRED, referral_code: "ABCD2345" } } },
    ...over,
  };
}

const referral = () => db.rows("referrals")[0];

beforeEach(() => {
  now = NOW;
  db = new FakeDb({
    organizations: [{ id: ORG, name: "Referred", plan: "none", stripe_customer_id: "cus_1", owner_id: REFERRED }],
    referrals: [
      {
        id: "ref_1",
        code: "ABCD2345",
        referrer_user_id: REFERRER,
        referred_user_id: REFERRED,
        referred_org_id: ORG,
        referred_label: "T.",
        status: "signed_up",
        commission_cents: 0,
        commission_status: null,
        first_paid_at: null,
        notes: null,
      },
    ],
  });
  deps = {
    db: db as unknown as SupabaseClient,
    stripe: { webhooks: realStripe.webhooks, subscriptions: { retrieve: vi.fn(async () => null) } },
    webhookSecret: SECRET,
    planForPrice: (p) => planFromPriceId(p, { STRIPE_PRICE_PROFESSIONAL_MONTHLY: "price_pro" } as unknown as NodeJS.ProcessEnv),
    now: () => now,
    referralCommissionPct: 30,
  };
});

describe("checkout carries the referral", () => {
  it("adds referral_code to session and subscription metadata only when present", () => {
    const base = {
      orgId: ORG,
      plan: "professional" as const,
      userId: REFERRED,
      customerId: "cus_1",
      priceId: "price_pro",
      baseUrl: "https://app.example",
      trialDays: 7,
      saleCoupon: undefined,
      now: NOW,
    };
    const withRef = buildSubscriptionCheckoutParams({ ...base, referralCode: "ABCD2345" });
    expect(withRef.metadata).toMatchObject({ referral_code: "ABCD2345" });
    expect(withRef.subscription_data?.metadata).toMatchObject({ referral_code: "ABCD2345" });
    expect(buildSubscriptionCheckoutParams(base).metadata).not.toHaveProperty("referral_code");
  });
});

describe("invoice.paid -> conversion", () => {
  it("$0 trial invoices don't convert", async () => {
    const res = await send("invoice.paid", invoice({ amount_paid: 0 }));
    expect(res.status).toBe(200);
    expect(referral().status).toBe("signed_up");
  });

  it("the first paid invoice converts with a pending commission of the configured %", async () => {
    const res = await send("invoice.paid", invoice());
    expect(res.status).toBe(200);
    expect(referral()).toMatchObject({
      status: "converted",
      first_paid_at: new Date(PAID_AT * 1000).toISOString(),
      first_invoice_id: "in_1",
      first_payment_intent_id: "pi_1",
      first_invoice_amount_cents: 24700,
      commission_pct: 30,
      commission_cents: 7410,
      commission_status: "pending",
    });
  });

  it("uses REFERRAL_COMMISSION_PCT when not injected", async () => {
    deps.referralCommissionPct = undefined;
    vi.stubEnv("REFERRAL_COMMISSION_PCT", "20");
    await send("invoice.payment_succeeded", invoice());
    vi.unstubAllEnvs();
    expect(referral().commission_cents).toBe(4940);
  });

  it("later invoices (and the twin invoice.payment_succeeded event) don't change it", async () => {
    await send("invoice.paid", invoice());
    await send("invoice.payment_succeeded", invoice());
    await send("invoice.paid", invoice({ id: "in_2", amount_paid: 99999 }));
    expect(referral()).toMatchObject({ first_invoice_id: "in_1", commission_cents: 7410 });
  });

  it("finds the org by Stripe customer when the invoice has no metadata", async () => {
    await send("invoice.paid", invoice({ parent: null, payments: null, payment_intent: "pi_old" }));
    expect(referral()).toMatchObject({ status: "converted", first_payment_intent_id: "pi_old" });
  });

  it("ignores workspaces that weren't referred", async () => {
    db.rows("organizations")[0].stripe_customer_id = "cus_other_org";
    const res = await send("invoice.paid", invoice({ customer: "cus_x", parent: null }));
    expect(res.status).toBe(200);
    expect(referral().status).toBe("signed_up");
  });
});

describe("charge.refunded -> void", () => {
  beforeEach(async () => {
    await send("invoice.paid", invoice());
  });

  it("a full refund within 30 days voids the commission", async () => {
    now = new Date("2026-12-10T00:00:00Z");
    await send("charge.refunded", { id: "ch_1", customer: "cus_1", payment_intent: "pi_1", refunded: true, amount: 24700, amount_refunded: 24700 });
    expect(referral()).toMatchObject({ status: "void", commission_status: "void" });
    expect(String(referral().notes)).toMatch(/commission voided/);
  });

  it("matches by customer when the payment intent wasn't known", async () => {
    referral().first_payment_intent_id = null;
    await send("charge.refunded", { id: "ch_1", customer: "cus_1", payment_intent: "pi_unknown", refunded: true, amount_refunded: 24700 });
    expect(referral().status).toBe("void");
  });

  it("a refund after 30 days keeps the commission", async () => {
    now = new Date("2026-12-27T12:00:00Z");
    await send("charge.refunded", { id: "ch_1", customer: "cus_1", payment_intent: "pi_1", refunded: true, amount_refunded: 24700 });
    expect(referral()).toMatchObject({ status: "converted", commission_status: "pending" });
  });

  it("a partial refund only adds a note", async () => {
    await send("charge.refunded", { id: "ch_1", customer: "cus_1", payment_intent: "pi_1", refunded: false, amount_refunded: 1000 });
    expect(referral()).toMatchObject({ status: "converted", commission_status: "pending" });
    expect(String(referral().notes)).toMatch(/partial refund of 10.00/);
  });

  it("a refund after payout keeps 'paid' and flags it for recovery", async () => {
    Object.assign(referral(), { status: "paid", commission_status: "paid" });
    await send("charge.refunded", { id: "ch_1", customer: "cus_1", payment_intent: "pi_1", refunded: true, amount_refunded: 24700 });
    expect(referral()).toMatchObject({ status: "void", commission_status: "paid" });
    expect(String(referral().notes)).toMatch(/recover it manually/);
  });
});
