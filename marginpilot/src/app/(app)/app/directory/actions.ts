"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePlan } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "@/components/ui/form";
import { planHasDirectory } from "@/lib/directory/entitlement";
import { noteSchema } from "@/lib/directory/validation";

/** Seller actions on the supplier directory. Each re-checks the plan; RLS enforces it again. */

const LOCKED: ActionState = { ok: false, message: "The supplier directory is included with the Professional and Mentorship plans." };

async function entitledContext() {
  const ctx = await requirePlan();
  return planHasDirectory(ctx.org.plan) ? ctx : null;
}

async function publishedSupplier(id: string) {
  const supabase = await createClient();
  const { data } = await supabase.from("directory_suppliers").select("id, name").eq("id", id).eq("status", "published").maybeSingle();
  return data as { id: string; name: string } | null;
}

export async function toggleFavorite(formData: FormData) {
  const ctx = await entitledContext();
  const id = z.uuid().safeParse(formData.get("id"));
  if (!ctx || !id.success) return;
  if (!(await publishedSupplier(id.data))) return;
  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("directory_favorites")
    .select("is_favorite")
    .eq("org_id", ctx.org.id)
    .eq("directory_supplier_id", id.data)
    .maybeSingle();
  await supabase.from("directory_favorites").upsert(
    {
      org_id: ctx.org.id,
      directory_supplier_id: id.data,
      is_favorite: !(existing?.is_favorite ?? false),
      updated_by: ctx.user.id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "org_id,directory_supplier_id" },
  );
  revalidatePath("/app/directory", "layout");
}

export async function saveNote(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await entitledContext();
  if (!ctx) return LOCKED;
  const id = z.uuid().safeParse(formData.get("id"));
  const note = noteSchema.safeParse(formData.get("note") ?? "");
  if (!id.success) return { ok: false, message: "Supplier not found." };
  if (!note.success) return { ok: false, message: note.error.issues[0].message, fieldErrors: { note: note.error.issues[0].message } };
  if (!(await publishedSupplier(id.data))) return { ok: false, message: "Supplier not found." };
  const supabase = await createClient();
  const { error } = await supabase.from("directory_favorites").upsert(
    {
      org_id: ctx.org.id,
      directory_supplier_id: id.data,
      note: note.data || null,
      updated_by: ctx.user.id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "org_id,directory_supplier_id" },
  );
  if (error) return { ok: false, message: "Couldn't save the note. Please try again." };
  revalidatePath(`/app/directory/${id.data}`);
  return { ok: true, message: note.data ? "Note saved. Only your workspace can see it." : "Note cleared." };
}

export type AddSupplierState = (NonNullable<ActionState> & { supplierId?: string }) | null;

export async function addToMySuppliers(_prev: AddSupplierState, formData: FormData): Promise<AddSupplierState> {
  const ctx = await entitledContext();
  if (!ctx) return LOCKED;
  const id = z.uuid().safeParse(formData.get("id"));
  if (!id.success) return { ok: false, message: "Supplier not found." };
  if (formData.get("attested") !== "on") {
    const msg = "Confirm you have (or are opening) a wholesale account with this supplier.";
    return { ok: false, message: msg, fieldErrors: { attested: msg } };
  }
  const entry = await publishedSupplier(id.data);
  if (!entry) return { ok: false, message: "This supplier is no longer in the directory." };

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("suppliers")
    .select("id")
    .eq("org_id", ctx.org.id)
    .eq("config->>directory_id", entry.id)
    .maybeSingle();
  if (existing) return { ok: true, message: `${entry.name} is already in your suppliers.`, supplierId: existing.id as string };

  const { data, error } = await supabase
    .from("suppliers")
    .insert({
      org_id: ctx.org.id,
      adapter: "csv_feed",
      name: entry.name,
      wholesale_attested: true,
      config: { directory_id: entry.id, added_from_directory_at: new Date().toISOString() },
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, message: "Couldn't add the supplier. Please try again." };
  revalidatePath("/app/listings/suppliers");
  revalidatePath(`/app/directory/${entry.id}`);
  return { ok: true, message: `Added ${entry.name} to your suppliers. Upload their price list to start listing.`, supplierId: data.id as string };
}
