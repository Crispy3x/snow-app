import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { assertWithinLimit, PlanLimitError } from "@/lib/limits";
import { createAdminClient } from "@/lib/supabase/admin";
import { encrypt } from "@/lib/crypto";
import { logActivity } from "@/lib/activity";
import { inngest, EVENTS } from "@/lib/inngest/client";
import { EBAY_SCOPES, ebayConfigured } from "@/lib/ebay/config";
import { EbayAuthError, exchangeCode } from "@/lib/ebay/oauth";
import { getUser } from "@/lib/ebay/api";
import { clientForToken } from "@/lib/ebay/store-api";

/**
 * eBay redirects here (the RuName's accept and decline URLs) after consent.
 * We exchange the code for tokens, learn the eBay user id from the Identity
 * API, and store the tokens encrypted. The seller's password never reaches us.
 */

const fail = (code: string): never => redirect(`/app/stores?error=${code}`);

export async function GET(req: NextRequest) {
  const user = await requireUser("/app/stores");
  if (!ebayConfigured()) fail("not_configured");

  const params = req.nextUrl.searchParams;
  const state = params.get("state");
  const code = params.get("code");

  const db = createAdminClient();

  // Validate and consume the state in one statement (single use).
  let orgId: string | null = null;
  if (state) {
    const { data } = await db.from("ebay_oauth_states").delete().eq("state", state).select("user_id, org_id, expires_at");
    const row = data?.[0] as { user_id: string; org_id: string; expires_at: string } | undefined;
    if (row && row.user_id === user.id && Date.parse(row.expires_at) > Date.now()) orgId = row.org_id;
  }

  if (params.get("error") || !code) fail("declined");
  if (!orgId) fail("state");

  // The user must still be an owner/admin of the org that started the flow.
  const { data: membership } = await db
    .from("memberships")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!membership || !["owner", "admin"].includes(membership.role as string)) fail("forbidden");

  let tokens: Awaited<ReturnType<typeof exchangeCode>>;
  let identity: { userId: string; username: string };
  try {
    tokens = await exchangeCode(code!);
    identity = await getUser(clientForToken(tokens.access_token));
  } catch (e) {
    console.error("eBay connect failed", e instanceof Error ? e.message : e);
    return fail(e instanceof EbayAuthError ? "token" : "identity");
  }

  const { data: existing } = await db
    .from("ebay_stores")
    .select("id, status, label")
    .eq("org_id", orgId)
    .eq("ebay_user_id", identity.userId)
    .maybeSingle();

  // A brand-new (or previously disconnected) store counts against the plan.
  if (!existing || existing.status === "disconnected") {
    try {
      await assertWithinLimit(orgId!, "stores");
    } catch (e) {
      if (e instanceof PlanLimitError) fail(e.limit === "no_plan" ? "no_plan" : "limit");
      throw e;
    }
  }

  const now = Date.now();
  const tokenFields = {
    ebay_username: identity.username,
    status: "active" as const,
    access_token_enc: encrypt(tokens.access_token),
    refresh_token_enc: tokens.refresh_token ? encrypt(tokens.refresh_token) : null,
    access_expires_at: new Date(now + tokens.expires_in * 1000).toISOString(),
    refresh_expires_at: tokens.refresh_token_expires_in ? new Date(now + tokens.refresh_token_expires_in * 1000).toISOString() : null,
    scopes: EBAY_SCOPES,
  };

  const { data: store, error } = await db
    .from("ebay_stores")
    .upsert(
      {
        org_id: orgId,
        ebay_user_id: identity.userId,
        label: existing?.label ?? identity.username,
        ...tokenFields,
        ...(existing ? {} : { connected_at: new Date(now).toISOString() }),
      },
      { onConflict: "org_id,ebay_user_id" },
    )
    .select("id")
    .single();
  if (error || !store) {
    console.error("eBay store upsert failed", error?.message);
    return fail("save");
  }
  const storeId = store.id as string;

  await db.from("store_rules").upsert({ store_id: storeId }, { onConflict: "store_id", ignoreDuplicates: true });
  await db
    .from("store_settings")
    .upsert({ store_id: storeId, org_id: orgId }, { onConflict: "store_id", ignoreDuplicates: true });

  const { data: profile } = await db.from("profiles").select("onboarding").eq("id", user.id).single();
  await db
    .from("profiles")
    .update({
      current_org_id: orgId,
      current_store_id: storeId,
      onboarding: { ...((profile?.onboarding as Record<string, unknown>) ?? {}), connected_ebay: true },
    })
    .eq("id", user.id);

  await logActivity({
    orgId: orgId!,
    storeId,
    actor: "user",
    userId: user.id,
    entityType: "store",
    entityId: storeId,
    action: existing ? "store_reconnected" : "store_connected",
    before: existing ? { status: existing.status } : null,
    after: { status: "active", ebay_username: identity.username },
  });

  try {
    await inngest.send({ name: EVENTS.storeConnected, data: { storeId } });
  } catch (e) {
    console.error("could not enqueue store sync", e instanceof Error ? e.message : e);
  }

  redirect(`/app/stores/${storeId}/rules?welcome=1`);
}
