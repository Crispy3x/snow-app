"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { canManage, getAppContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logActivity } from "@/lib/activity";
import type { ActionState } from "@/components/ui/form";

const labelSchema = z.object({
  storeId: z.uuid(),
  label: z.string().trim().min(1, "Enter a name.").max(60, "Keep it under 60 characters."),
});

export async function renameStore(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getAppContext();
  if (!canManage(ctx.role)) return { ok: false, message: "Only workspace owners and admins can rename stores." };
  const parsed = labelSchema.safeParse({ storeId: formData.get("storeId"), label: formData.get("label") });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the name.", fieldErrors: { label: parsed.error.issues[0]?.message ?? "" } };

  const store = ctx.stores.find((s) => s.id === parsed.data.storeId);
  if (!store) return { ok: false, message: "Store not found." };

  // RLS + column grant: owners/admins may update label only.
  const supabase = await createClient();
  const { error } = await supabase.from("ebay_stores").update({ label: parsed.data.label }).eq("id", store.id).eq("org_id", ctx.org.id);
  if (error) return { ok: false, message: "Could not rename the store. Try again." };

  await logActivity({
    orgId: ctx.org.id,
    storeId: store.id,
    actor: "user",
    userId: ctx.user.id,
    entityType: "store",
    entityId: store.id,
    action: "store_renamed",
    before: { label: store.label },
    after: { label: parsed.data.label },
  });
  revalidatePath("/app", "layout");
  return { ok: true, message: "Name saved." };
}

/** Wipes the tokens (we keep no access to the eBay account) and marks the store disconnected. */
export async function disconnectStore(formData: FormData): Promise<void> {
  const ctx = await getAppContext();
  if (!canManage(ctx.role)) return;
  const storeId = String(formData.get("storeId") ?? "");
  const store = ctx.stores.find((s) => s.id === storeId);
  if (!store) return;

  const db = createAdminClient();
  await db
    .from("ebay_stores")
    .update({
      status: "disconnected",
      access_token_enc: null,
      refresh_token_enc: null,
      access_expires_at: null,
      refresh_expires_at: null,
    })
    .eq("id", store.id)
    .eq("org_id", ctx.org.id);

  await logActivity({
    orgId: ctx.org.id,
    storeId: store.id,
    actor: "user",
    userId: ctx.user.id,
    entityType: "store",
    entityId: store.id,
    action: "store_disconnected",
    before: { status: store.status },
    after: { status: "disconnected" },
  });
  revalidatePath("/app", "layout");
}
