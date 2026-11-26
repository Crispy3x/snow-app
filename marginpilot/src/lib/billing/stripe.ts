import "server-only";
import Stripe from "stripe";
import { PLANS, type PlanKey } from "@/config/plans";

/**
 * Stripe client and the plan <-> price mapping. Price IDs live in env vars so
 * test and live mode differ only by configuration.
 */

let cached: Stripe | null = null;

export function getStripe(): Stripe {
  if (cached) return cached;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("Stripe is not configured (STRIPE_SECRET_KEY is missing)");
  cached = new Stripe(key, { appInfo: { name: "MarginPilot" } });
  return cached;
}

export function isStripeConfigured(): boolean {
  return !!process.env.STRIPE_SECRET_KEY;
}

const PRICE_ENV: Record<PlanKey, string> = {
  starter: "STRIPE_PRICE_STARTER_MONTHLY",
  professional: "STRIPE_PRICE_PROFESSIONAL_MONTHLY",
  mentorship: "STRIPE_PRICE_MENTORSHIP_MONTHLY",
};

/** A real price id, or undefined when the env var is unset or still the "price_" placeholder. */
function envPrice(name: string, env: NodeJS.ProcessEnv): string | undefined {
  const v = env[name]?.trim();
  return v && v !== "price_" ? v : undefined;
}

export function priceIdForPlan(plan: PlanKey, env: NodeJS.ProcessEnv = process.env): string {
  const id = envPrice(PRICE_ENV[plan], env);
  if (!id) throw new Error(`Stripe price for the ${plan} plan is not configured (${PRICE_ENV[plan]})`);
  return id;
}

export function planFromPriceId(priceId: string | null | undefined, env: NodeJS.ProcessEnv = process.env): PlanKey | null {
  if (!priceId) return null;
  for (const p of PLANS) {
    if (envPrice(PRICE_ENV[p.key], env) === priceId) return p.key;
  }
  return null;
}

export function coursePriceId(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return envPrice("STRIPE_PRICE_COURSE_ONE_TIME", env);
}

export function trialDays(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number.parseInt(env.STRIPE_TRIAL_DAYS ?? "", 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 730) : 0;
}

export function saleCouponId(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env.STRIPE_COUPON_SALE?.trim() || undefined;
}

export function isPlanKey(v: unknown): v is PlanKey {
  return v === "starter" || v === "professional" || v === "mentorship";
}
