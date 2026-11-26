import "server-only";
import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { REF_COOKIE } from "./code";
import { recordSignupReferral } from "./server";

/**
 * Called by the signup action right after the account is created. Reads the
 * first-touch mp_ref cookie and records the referral. Never throws.
 */
export async function attachSignupReferral(user: { userId: string; email: string; fullName: string }): Promise<void> {
  try {
    const jar = await cookies();
    const raw = jar.get(REF_COOKIE)?.value;
    if (!raw) return;
    const db = createAdminClient();
    const result = await recordSignupReferral(
      {
        db,
        userEmail: async (id) => {
          const { data } = await db.auth.admin.getUserById(id);
          return data?.user?.email ?? null;
        },
      },
      { rawCode: raw, referredUserId: user.userId, referredEmail: user.email, referredName: user.fullName },
    );
    // The cookie has done its job (or can never work); a transient error keeps it for another try.
    if (result !== "error") jar.delete(REF_COOKIE);
  } catch (e) {
    console.error("[referrals] attach signup referral failed", e);
  }
}
