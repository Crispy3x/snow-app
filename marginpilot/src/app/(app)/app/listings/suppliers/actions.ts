"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { canManage, requirePlan } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "@/components/ui/form";
import { formatLineErrors, parsePriceList } from "@/lib/lister/bulk-input";

const MAX_FILE = 950 * 1024; // server actions accept ~1 MB bodies

const addSchema = z.object({
  name: z.string().trim().min(2, "Give the supplier a name.").max(80),
  adapter: z.enum(["mock", "csv_feed"], { message: "Choose a supplier type." }),
  attested: z.literal("on", { message: "Confirm you have a wholesale relationship with this supplier." }),
});

async function readCsv(file: FormDataEntryValue | null): Promise<{ text?: string; error?: string }> {
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a CSV price list to upload." };
  if (file.size > MAX_FILE) return { error: "That file is over 950 KB. Split the price list or remove unused columns." };
  if (!/\.(csv|txt)$/i.test(file.name) && !/csv|text\/plain/.test(file.type)) return { error: "Upload a .csv file." };
  return { text: await file.text() };
}

export async function addSupplier(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requirePlan();
  const parsed = addSchema.safeParse({
    name: formData.get("name"),
    adapter: formData.get("adapter"),
    attested: formData.get("attested") ?? undefined,
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of parsed.error.issues) fieldErrors[String(i.path[0])] ??= i.message;
    return { ok: false, message: "Check the highlighted fields.", fieldErrors };
  }
  let config: Record<string, unknown> = {};
  if (parsed.data.adapter === "csv_feed") {
    const { text, error } = await readCsv(formData.get("file"));
    if (error) return { ok: false, message: error, fieldErrors: { file: error } };
    const { rows, errors } = parsePriceList(text!);
    if (errors.length || rows.length === 0) {
      const msg = errors.length ? `Fix the price list and upload it again:\n${formatLineErrors(errors)}` : "The price list has no product rows.";
      return { ok: false, message: msg, fieldErrors: { file: "Fix the price list and upload it again." } };
    }
    config = { rows, row_count: rows.length, uploaded_at: new Date().toISOString(), file_name: (formData.get("file") as File).name };
  }
  const supabase = await createClient();
  const { error } = await supabase.from("suppliers").insert({
    org_id: ctx.org.id,
    adapter: parsed.data.adapter,
    name: parsed.data.name,
    wholesale_attested: true,
    config,
  });
  if (error) return { ok: false, message: "Couldn't add the supplier. Please try again." };
  revalidatePath("/app/listings/suppliers");
  return { ok: true, message: `Added ${parsed.data.name}.` };
}

export async function uploadPriceList(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requirePlan();
  const supplierId = String(formData.get("supplierId") ?? "");
  const supabase = await createClient();
  const { data: supplier } = await supabase
    .from("suppliers")
    .select("id, adapter, config")
    .eq("id", supplierId)
    .eq("org_id", ctx.org.id)
    .maybeSingle();
  if (!supplier || supplier.adapter !== "csv_feed") return { ok: false, message: "Supplier not found." };
  const { text, error } = await readCsv(formData.get("file"));
  if (error) return { ok: false, message: error };
  const { rows, errors } = parsePriceList(text!);
  if (errors.length || rows.length === 0) return { ok: false, message: errors.length ? `Fix the price list and upload it again:\n${formatLineErrors(errors)}` : "The price list has no product rows." };
  // Only the feed is replaced. Cost and stock changes reach live listings through the
  // price and stock monitor, which compares against supplier_products and proposes changes.
  const config = { ...(supplier.config as Record<string, unknown>), rows, row_count: rows.length, uploaded_at: new Date().toISOString(), file_name: (formData.get("file") as File).name };
  const { error: upErr } = await supabase.from("suppliers").update({ config }).eq("id", supplier.id).eq("org_id", ctx.org.id);
  if (upErr) return { ok: false, message: "Couldn't save the price list. Please try again." };
  revalidatePath("/app/listings/suppliers");
  return { ok: true, message: `Price list updated: ${rows.length.toLocaleString()} products.` };
}

export async function removeSupplier(formData: FormData) {
  const ctx = await requirePlan();
  if (!canManage(ctx.role)) return;
  const supabase = await createClient();
  await supabase.from("suppliers").delete().eq("id", String(formData.get("supplierId") ?? "")).eq("org_id", ctx.org.id);
  revalidatePath("/app/listings/suppliers");
}
