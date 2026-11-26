"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { canManage, getAppContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logActivity } from "@/lib/activity";
import { getEbayClient, EbayApiError, EbayRateLimitError } from "@/lib/ebay/client";
import { createLocation } from "@/lib/ebay/api";
import { parseRulesForm } from "@/lib/ebay/rules";
import type { ActionState } from "@/components/ui/form";

async function authorise(storeId: string) {
  const ctx = await getAppContext();
  const store = ctx.stores.find((s) => s.id === storeId);
  if (!store) return { error: "Store not found." } as const;
  if (!canManage(ctx.role)) return { error: "Only workspace owners and admins can change store rules." } as const;
  return { ctx, store } as const;
}

export async function saveRules(storeId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const auth = await authorise(storeId);
  if ("error" in auth) return { ok: false, message: auth.error };
  const { ctx } = auth;

  const parsed = parseRulesForm(formData);
  if (!parsed.ok) return { ok: false, message: "Check the highlighted fields.", fieldErrors: parsed.fieldErrors };

  const supabase = await createClient();
  const { data: before } = await supabase.from("store_rules").select("*").eq("store_id", storeId).maybeSingle();
  const { error } = await supabase
    .from("store_rules")
    .upsert({ store_id: storeId, ...parsed.rules, updated_at: new Date().toISOString() }, { onConflict: "store_id" });
  if (error) return { ok: false, message: "Could not save the rules. Try again." };

  if (!ctx.onboarding.set_rules) {
    await supabase
      .from("profiles")
      .update({ onboarding: { ...ctx.onboarding, set_rules: true } })
      .eq("id", ctx.user.id);
  }

  await logActivity({
    orgId: ctx.org.id,
    storeId,
    actor: "user",
    userId: ctx.user.id,
    entityType: "rules",
    entityId: storeId,
    action: "rules_updated",
    before: (before as Record<string, unknown> | null) ?? null,
    after: parsed.rules as unknown as Record<string, unknown>,
  });
  revalidatePath(`/app/stores/${storeId}/rules`);
  revalidatePath("/app");
  return { ok: true, message: "Rules saved. New listings, repricing and offers will use them." };
}

const settingsSchema = z.object({
  fulfillment_policy_id: z.string().max(40).nullable(),
  payment_policy_id: z.string().max(40).nullable(),
  return_policy_id: z.string().max(40).nullable(),
  merchant_location_key: z.string().max(36).nullable(),
});

const blankToNull = (v: FormDataEntryValue | null) => (v === null || String(v).trim() === "" ? null : String(v).trim());

export async function saveListingDefaults(storeId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const auth = await authorise(storeId);
  if ("error" in auth) return { ok: false, message: auth.error };
  const { ctx } = auth;

  const parsed = settingsSchema.safeParse({
    fulfillment_policy_id: blankToNull(formData.get("fulfillment_policy_id")),
    payment_policy_id: blankToNull(formData.get("payment_policy_id")),
    return_policy_id: blankToNull(formData.get("return_policy_id")),
    merchant_location_key: blankToNull(formData.get("merchant_location_key")),
  });
  if (!parsed.success) return { ok: false, message: "Those choices couldn't be read. Reload and try again." };

  const supabase = await createClient();
  const { data: before } = await supabase.from("store_settings").select("*").eq("store_id", storeId).maybeSingle();
  const { error } = await supabase
    .from("store_settings")
    .upsert({ store_id: storeId, org_id: ctx.org.id, ...parsed.data, updated_at: new Date().toISOString() }, { onConflict: "store_id" });
  if (error) return { ok: false, message: "Could not save the listing defaults. Try again." };

  await logActivity({
    orgId: ctx.org.id,
    storeId,
    actor: "user",
    userId: ctx.user.id,
    entityType: "store",
    entityId: storeId,
    action: "listing_defaults_updated",
    before: (before as Record<string, unknown> | null) ?? null,
    after: parsed.data,
  });
  revalidatePath(`/app/stores/${storeId}/rules`);
  return { ok: true, message: "Listing defaults saved." };
}

const locationSchema = z.object({
  postal_code: z
    .string()
    .trim()
    .min(3, "Enter the postal code items ship from.")
    .max(12, "That postal code is too long.")
    .regex(/^[A-Za-z0-9 -]+$/, "Letters, numbers, spaces and dashes only."),
  country: z.enum(["US", "CA", "GB", "AU", "DE", "FR", "IT", "ES"]),
});

/** Creates an Inventory API location (needed on every offer) and makes it the default. */
export async function createDefaultLocation(storeId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const auth = await authorise(storeId);
  if ("error" in auth) return { ok: false, message: auth.error };
  const { ctx, store } = auth;
  if (store.status !== "active") return { ok: false, message: "Reconnect this store first." };

  const parsed = locationSchema.safeParse({ postal_code: formData.get("postal_code"), country: formData.get("country") });
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? "Check the postal code.";
    return { ok: false, message: msg, fieldErrors: { [String(parsed.error.issues[0]?.path[0] ?? "postal_code")]: msg } };
  }
  const { postal_code, country } = parsed.data;
  const key = `mp-${country}-${postal_code.replace(/[^A-Za-z0-9]/g, "").toLowerCase()}`.slice(0, 36);

  try {
    await createLocation(await getEbayClient(storeId), key, { postalCode: postal_code, country });
  } catch (e) {
    // 409 / errorId 25803: the location already exists, which is fine to reuse.
    const exists = e instanceof EbayApiError && (e.status === 409 || e.errors.some((x) => x.errorId === 25803));
    if (!exists) {
      if (e instanceof EbayRateLimitError) return { ok: false, message: "eBay is busy right now. Try again in a minute." };
      return { ok: false, message: `eBay didn't create the location: ${e instanceof Error ? e.message : "unknown error"}` };
    }
  }

  const supabase = await createClient();
  const { error } = await supabase.from("store_settings").upsert(
    {
      store_id: storeId,
      org_id: ctx.org.id,
      merchant_location_key: key,
      location_postal_code: postal_code,
      location_country: country,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "store_id" },
  );
  if (error) return { ok: false, message: "The location was created on eBay but couldn't be saved here. Try again." };

  await logActivity({
    orgId: ctx.org.id,
    storeId,
    actor: "user",
    userId: ctx.user.id,
    entityType: "store",
    entityId: storeId,
    action: "location_created",
    after: { merchant_location_key: key, postal_code, country },
  });
  revalidatePath(`/app/stores/${storeId}/rules`);
  return { ok: true, message: `Location ${key} is ready and set as the default.` };
}
