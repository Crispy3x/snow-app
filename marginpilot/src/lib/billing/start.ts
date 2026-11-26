import "server-only";
import { canManage, getAppContext } from "@/lib/auth";
import type { PlanKey } from "@/config/plans";
import { changeSubscriptionPlan, createSubscriptionCheckout, liveSubscription } from "./checkout";

export type StartErrorCode = "not_allowed" | "same_plan" | "has_subscription" | "stripe";

export const START_ERRORS: Record<StartErrorCode, string> = {
  not_allowed: "Only the workspace owner or an admin can change the plan.",
  same_plan: "You're already on this plan.",
  has_subscription: "You already have a subscription. Switch plans below.",
  stripe: "We couldn't reach our payment provider. Please try again in a minute.",
};

const fail = (code: StartErrorCode): StartResult => ({ kind: "error", code, message: START_ERRORS[code] });

export type StartResult = { kind: "redirect"; url: string } | { kind: "changed" } | { kind: "error"; code: StartErrorCode; message: string };

/**
 * Subscribe or switch plan for the signed-in user's current workspace.
 * Only owners and admins may buy. A workspace with a live subscription is
 * switched in place (keeps any lifetime sale discount); otherwise we send
 * the user to Stripe Checkout.
 */
export async function startPlanForCurrentUser(plan: PlanKey, opts: { allowChange: boolean }): Promise<StartResult> {
  const ctx = await getAppContext();
  if (!canManage(ctx.role)) {
    return fail("not_allowed");
  }
  try {
    const live = await liveSubscription(ctx.org.id);
    if (live && live.status !== "incomplete") {
      if (live.plan === plan) return fail("same_plan");
      if (!opts.allowChange) return fail("has_subscription");
      const changed = await changeSubscriptionPlan(ctx.org.id, plan);
      if (changed) return { kind: "changed" };
    }
    const url = await createSubscriptionCheckout(ctx.org.id, plan, { id: ctx.user.id, email: ctx.user.email });
    return { kind: "redirect", url };
  } catch (e) {
    console.error("[billing] start plan failed", e);
    return fail("stripe");
  }
}
