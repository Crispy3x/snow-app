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
  listingAudit: boolean;
  supplierDirectory: boolean;
};

export type Plan = {
  key: PlanKey;
  name: string;
  /** Regular monthly price in USD (what Stripe charges before any sale coupon). */
  monthly: number;
  /** Crossed-out "compare at" price shown next to the price people pay. */
  compareAt: number;
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
    compareAt: 197,
    blurb: "For one store getting its rules in place.",
    features: [
      "1 eBay store",
      "Up to 500 active listings",
      "Bulk AI lister and margin guard",
      "Price and stock monitor",
      "Order queue and tracking",
      "Photo-to-listing and background studio",
      "300 AI credits a month",
    ],
    limits: { stores: 1, listings: 500, aiCreditsPerMonth: 300, seats: 1, course: false, mentorship: false, listingAudit: false, supplierDirectory: false },
  },
  {
    key: "professional",
    name: "Professional",
    monthly: 494,
    compareAt: 697,
    blurb: "For sellers running several stores, with the full course included.",
    features: [
      "Up to 5 eBay stores",
      "Up to 5,000 active listings",
      "Everything in Starter",
      "Offers, sale events and promoted listing rules",
      "Store cleanup and listing audit",
      "Vetted wholesale supplier directory",
      "3 team seats",
      "2,000 AI credits a month",
      "Full video course included",
    ],
    limits: { stores: 5, listings: 5000, aiCreditsPerMonth: 2000, seats: 3, course: true, mentorship: false, listingAudit: true, supplierDirectory: true },
    highlight: true,
    badge: "Most popular",
  },
  {
    key: "mentorship",
    name: "Mentorship",
    monthly: 994,
    compareAt: 1497,
    blurb: "Everything in Professional, plus direct guidance while you scale.",
    features: [
      "Up to 15 eBay stores",
      "Up to 20,000 active listings",
      "Everything in Professional",
      "Weekly mentorship calls",
      "Weekly store audit with written feedback",
      "Mentorship hub with call recordings",
      "Priority support",
      "10 team seats",
      "6,000 AI credits a month",
    ],
    limits: { stores: 15, listings: 20000, aiCreditsPerMonth: 6000, seats: 10, course: true, mentorship: true, listingAudit: true, supplierDirectory: true },
  },
];

/**
 * Current promotion. The sale price is shown only while `now` is between
 * startsAt and endsAt, so it switches itself off without a redeploy.
 * In Stripe: a 50%-off coupon with duration "forever" (STRIPE_COUPON_SALE),
 * attached at checkout only while the sale is active. Subscribers who join
 * during the sale keep the discount for as long as they stay subscribed.
 */
export const SALE = {
  name: "Black Friday",
  percentOff: 50,
  startsAt: "2026-11-24T00:00:00Z",
  endsAt: "2027-01-01T07:59:59Z", // end of Dec 31, Pacific time
  discountIsForever: true,
};

export function isSaleActive(now: Date, sale = SALE): boolean {
  const t = now.getTime();
  return t >= Date.parse(sale.startsAt) && t <= Date.parse(sale.endsAt);
}

export function salePrice(regular: number, percentOff = SALE.percentOff): number {
  return Math.round(regular * (100 - percentOff)) / 100;
}

export function formatUsd(value: number): string {
  const opts = Number.isInteger(value) ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 };
  return "$" + value.toLocaleString("en-US", opts);
}

/** Percent saved versus the crossed-out price, rounded down. */
export function savingsPct(pays: number, compareAt: number): number {
  return compareAt > pays ? Math.floor(((compareAt - pays) / compareAt) * 100) : 0;
}

export function getPlan(key: string): Plan | undefined {
  return PLANS.find((p) => p.key === key);
}
