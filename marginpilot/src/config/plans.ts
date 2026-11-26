/**
 * Plans, prices, limits and the current sale, in one place.
 * The pricing section, signup links, plan-limit checks and (from Phase 2)
 * Stripe checkout all read from here. Stripe price IDs come from env vars.
 */

export type PlanKey = "starter" | "professional" | "mentorship";

export type PlanLimits = {
  stores: number;
  listings: number; // active listings managed
  aiCreditsPerMonth: number;
  seats: number;
  course: boolean;
  mentorship: boolean;
};

export type Plan = {
  key: PlanKey;
  name: string;
  /** Regular monthly price in USD. */
  monthly: number;
  blurb: string;
  features: string[];
  limits: PlanLimits;
  highlight?: boolean;
  badge?: string;
};

export const PLANS: Plan[] = [
  {
    key: "starter",
    name: "Starter",
    monthly: 94,
    blurb: "For one store getting its rules in place.",
    features: [
      "1 eBay store",
      "Up to 500 active listings",
      "Bulk AI lister and margin guard",
      "Price and stock monitor",
      "Order queue and tracking",
      "300 AI credits a month",
    ],
    limits: { stores: 1, listings: 500, aiCreditsPerMonth: 300, seats: 1, course: false, mentorship: false },
  },
  {
    key: "professional",
    name: "Professional",
    monthly: 494,
    blurb: "For sellers running several stores, with the full course included.",
    features: [
      "Up to 5 eBay stores",
      "Up to 5,000 active listings",
      "Everything in Starter",
      "Offers, sale events and promoted listing rules",
      "Store cleanup and listing audit",
      "3 team seats",
      "2,000 AI credits a month",
      "Full video course included",
    ],
    limits: { stores: 5, listings: 5000, aiCreditsPerMonth: 2000, seats: 3, course: true, mentorship: false },
    highlight: true,
    badge: "Most popular",
  },
  {
    key: "mentorship",
    name: "Mentorship",
    monthly: 994,
    blurb: "Everything in Professional, plus direct guidance while you scale.",
    features: [
      "Up to 15 eBay stores",
      "Up to 20,000 active listings",
      "Everything in Professional",
      "Weekly mentorship calls",
      "Weekly store audit with written feedback",
      "Priority support",
      "10 team seats",
      "6,000 AI credits a month",
    ],
    limits: { stores: 15, listings: 20000, aiCreditsPerMonth: 6000, seats: 10, course: true, mentorship: true },
  },
];

/**
 * Current promotion. The sale price is shown only while `now` is between
 * startsAt and endsAt, so it switches itself off without a redeploy.
 * In Stripe: a 50%-off coupon (STRIPE_COUPON_SALE) on a subscription schedule phase ending at discountEndsAt.
 */
export const SALE = {
  name: "Black Friday",
  percentOff: 50,
  startsAt: "2026-11-24T00:00:00Z",
  endsAt: "2026-12-01T07:59:59Z", // end of Cyber Monday, Pacific time
  /**
   * Subscribers who sign up during the sale pay the sale price on every bill
   * dated before this moment, then the regular price. Stripe coupons can't end
   * on a calendar date, so Phase 2 uses a subscription schedule whose discounted
   * phase ends here.
   */
  discountEndsAt: "2027-01-01T08:00:00Z", // midnight Jan 1, Pacific time
};

export function isSaleActive(now: Date, sale = SALE): boolean {
  const t = now.getTime();
  return t >= Date.parse(sale.startsAt) && t <= Date.parse(sale.endsAt);
}

export function salePrice(regular: number, percentOff = SALE.percentOff): number {
  return Math.round(regular * (100 - percentOff)) / 100;
}

export function formatUsd(value: number): string {
  return Number.isInteger(value) ? `$${value}` : `$${value.toFixed(2)}`;
}

export function getPlan(key: string): Plan | undefined {
  return PLANS.find((p) => p.key === key);
}
