import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { buildSubscriptionCheckoutParams } from "../checkout";
import { trialDays } from "../stripe";

const base = {
  orgId: "org_1",
  plan: "professional" as const,
  userId: "user_1",
  customerId: "cus_1",
  priceId: "price_pro",
  baseUrl: "https://app.example",
  trialDays: 7,
  saleCoupon: "SALE50",
};

describe("buildSubscriptionCheckoutParams", () => {
  it("during the sale: subscription mode, org + plan on session and subscription, forever coupon attached", () => {
    const p = buildSubscriptionCheckoutParams({ ...base, now: new Date("2026-11-26T12:00:00Z") });
    expect(p.mode).toBe("subscription");
    expect(p.customer).toBe("cus_1");
    expect(p.client_reference_id).toBe("org_1");
    expect(p.line_items).toEqual([{ price: "price_pro", quantity: 1 }]);
    expect(p.metadata).toMatchObject({ org_id: "org_1", plan: "professional", sale: "true" });
    expect(p.subscription_data).toMatchObject({ trial_period_days: 7, metadata: { org_id: "org_1", plan: "professional", sale: "true" } });
    expect(p.discounts).toEqual([{ coupon: "SALE50" }]);
    expect(p.success_url).toBe("https://app.example/app/billing?checkout=success");
  });

  it("after the sale ends: no coupon", () => {
    const p = buildSubscriptionCheckoutParams({ ...base, now: new Date("2027-01-02T00:00:00Z") });
    expect(p.discounts).toBeUndefined();
    expect(p.metadata?.sale).toBe("false");
  });

  it("before the sale starts: no coupon", () => {
    const p = buildSubscriptionCheckoutParams({ ...base, now: new Date("2026-11-23T23:59:59Z") });
    expect(p.discounts).toBeUndefined();
  });

  it("without a configured coupon: no discount even during the sale", () => {
    const p = buildSubscriptionCheckoutParams({ ...base, saleCoupon: undefined, now: new Date("2026-12-01T00:00:00Z") });
    expect(p.discounts).toBeUndefined();
    expect(p.metadata?.sale).toBe("false");
  });

  it("no trial for returning subscribers", () => {
    const p = buildSubscriptionCheckoutParams({ ...base, trialDays: 0, now: new Date("2026-12-01T00:00:00Z") });
    expect(p.subscription_data).not.toHaveProperty("trial_period_days");
  });
});

describe("trialDays", () => {
  it("parses STRIPE_TRIAL_DAYS and treats junk as no trial", () => {
    expect(trialDays({ STRIPE_TRIAL_DAYS: "7" } as unknown as NodeJS.ProcessEnv)).toBe(7);
    expect(trialDays({ STRIPE_TRIAL_DAYS: "" } as unknown as NodeJS.ProcessEnv)).toBe(0);
    expect(trialDays({ STRIPE_TRIAL_DAYS: "-3" } as unknown as NodeJS.ProcessEnv)).toBe(0);
    expect(trialDays({} as NodeJS.ProcessEnv)).toBe(0);
  });
});
