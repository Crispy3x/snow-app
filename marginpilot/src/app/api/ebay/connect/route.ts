import { randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { canManage, getAppContext } from "@/lib/auth";
import { assertWithinLimit, PlanLimitError } from "@/lib/limits";
import { createAdminClient } from "@/lib/supabase/admin";
import { ebayConfigured } from "@/lib/ebay/config";
import { consentUrl } from "@/lib/ebay/oauth";

/**
 * Starts the eBay consent flow. ?reconnect=<storeId> re-authorises an existing
 * store without counting it against the plan's store limit again.
 */
export async function GET(req: NextRequest) {
  const ctx = await getAppContext(); // redirects to /login when signed out
  if (!canManage(ctx.role)) redirect("/app/stores?error=forbidden");
  if (!ebayConfigured()) redirect("/app/stores?error=not_configured");

  const reconnectId = req.nextUrl.searchParams.get("reconnect");
  const existing = reconnectId ? ctx.stores.find((s) => s.id === reconnectId && s.status !== "disconnected") : undefined;

  if (!existing) {
    try {
      await assertWithinLimit(ctx.org.id, "stores");
    } catch (e) {
      if (e instanceof PlanLimitError) redirect(`/app/stores?error=${e.limit === "no_plan" ? "no_plan" : "limit"}`);
      throw e;
    }
  }

  const state = randomBytes(24).toString("base64url");
  const db = createAdminClient();
  // Housekeeping: drop expired states.
  await db.from("ebay_oauth_states").delete().lt("expires_at", new Date().toISOString());
  const { error } = await db.from("ebay_oauth_states").insert({
    state,
    user_id: ctx.user.id,
    org_id: ctx.org.id,
    expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
  });
  if (error) redirect("/app/stores?error=state");

  redirect(consentUrl(state));
}
