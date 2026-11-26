import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { generateCode, maskedName, normalizeCode } from "./code";
import { isSelfReferral } from "./commission";

/**
 * Server-side referral writes. All go through the service-role client:
 * users can read their own code and referrals (RLS) but never write them.
 */

/** The user's referral code, created on first call. Retries on the (rare) code collision. */
export async function getOrCreateReferralCode(db: SupabaseClient, userId: string, gen: () => string = () => generateCode()): Promise<string> {
  const existing = await db.from("referral_codes").select("code").eq("user_id", userId).maybeSingle();
  if (existing.data?.code) return existing.data.code as string;

  for (let attempt = 0; attempt < 6; attempt++) {
    const code = gen();
    const { error } = await db.from("referral_codes").insert({ user_id: userId, code });
    if (!error) return code;
    if (error.code !== "23505") throw new Error(`create referral code: ${error.message}`);
    // Either another request created this user's code first, or the code is taken: re-read, then retry.
    const again = await db.from("referral_codes").select("code").eq("user_id", userId).maybeSingle();
    if (again.data?.code) return again.data.code as string;
  }
  throw new Error("create referral code: too many collisions");
}

export type SignupReferralResult = "recorded" | "invalid_code" | "unknown_code" | "self_referral" | "already_referred" | "error";

/**
 * Records that `referredUserId` signed up through `rawCode` (from the mp_ref cookie).
 * Blocks self-referrals (same user, or the same email ignoring +tags). Never throws.
 */
export async function recordSignupReferral(
  deps: { db: SupabaseClient; userEmail: (userId: string) => Promise<string | null> },
  input: { rawCode: string | null | undefined; referredUserId: string; referredEmail: string; referredName: string | null; referredOrgId?: string | null },
): Promise<SignupReferralResult> {
  const { db } = deps;
  const code = normalizeCode(input.rawCode);
  if (!code) return "invalid_code";
  try {
    const { data: owner } = await db.from("referral_codes").select("user_id, code").eq("code", code).maybeSingle();
    if (!owner) return "unknown_code";
    const referrerUserId = owner.user_id as string;
    const referrerEmail = referrerUserId === input.referredUserId ? null : await deps.userEmail(referrerUserId);
    if (isSelfReferral({ referrerUserId, referredUserId: input.referredUserId, referrerEmail, referredEmail: input.referredEmail })) {
      return "self_referral";
    }

    const prior = await db.from("referrals").select("id").eq("referred_user_id", input.referredUserId).limit(1).maybeSingle();
    if (prior.data) return "already_referred";

    let orgId = input.referredOrgId ?? null;
    if (!orgId) {
      const { data: org } = await db
        .from("organizations")
        .select("id")
        .eq("owner_id", input.referredUserId)
        .order("created_at")
        .limit(1)
        .maybeSingle();
      orgId = (org?.id as string | undefined) ?? null;
    }

    const { error } = await db.from("referrals").insert({
      code,
      referrer_user_id: referrerUserId,
      referred_user_id: input.referredUserId,
      referred_org_id: orgId,
      referred_label: maskedName(input.referredName),
      status: "signed_up",
    });
    if (error) return error.code === "23505" ? "already_referred" : "error";
    return "recorded";
  } catch (e) {
    console.error("[referrals] record signup failed", e);
    return "error";
  }
}

/** The referral code to put on a workspace's Stripe checkout, if it signed up through one and hasn't converted. */
export async function referralCodeForOrg(db: SupabaseClient, orgId: string): Promise<string | undefined> {
  const { data } = await db
    .from("referrals")
    .select("code")
    .eq("referred_org_id", orgId)
    .eq("status", "signed_up")
    .limit(1)
    .maybeSingle();
  return (data?.code as string | undefined) ?? undefined;
}
