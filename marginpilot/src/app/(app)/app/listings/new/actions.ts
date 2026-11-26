"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requireStore } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { assertWithinLimit, PlanLimitError } from "@/lib/limits";
import { inngest, EVENTS } from "@/lib/inngest/client";
import type { ActionState } from "@/components/ui/form";
import { formatLineErrors, parseCsvItems, parseLinks } from "@/lib/lister/bulk-input";
import { loadStoreRules } from "@/lib/lister/store";

const schema = z.object({
  supplierId: z.string().uuid("Choose a supplier."),
  source: z.enum(["links", "csv"]),
  mode: z.enum(["draft", "publish"]),
  targetMargin: z.coerce.number().min(0).max(80, "Target margin must be 80% or less."),
  input: z.string().max(400_000, "That's too much input for one batch."),
});

export async function createBulkJob(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireStore();
  const parsed = schema.safeParse({
    supplierId: formData.get("supplierId"),
    source: formData.get("source"),
    mode: formData.get("mode"),
    targetMargin: formData.get("targetMargin"),
    input: formData.get("input") ?? "",
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of parsed.error.issues) fieldErrors[String(i.path[0])] ??= i.message;
    return { ok: false, message: "Check the highlighted fields.", fieldErrors };
  }
  const { supplierId, source, mode, targetMargin } = parsed.data;
  let input = parsed.data.input;
  const file = formData.get("file");
  if (source === "csv" && file instanceof File && file.size > 0) {
    if (file.size > 950 * 1024) return { ok: false, message: "That file is over 950 KB. Split it into smaller batches.", fieldErrors: { file: "File too large." } };
    input = await file.text();
  }

  const supabase = await createClient();
  const { data: supplier } = await supabase
    .from("suppliers")
    .select("id, adapter, wholesale_attested")
    .eq("id", supplierId)
    .eq("org_id", ctx.org.id)
    .maybeSingle();
  if (!supplier) return { ok: false, message: "Supplier not found.", fieldErrors: { supplierId: "Choose a supplier." } };
  if (!supplier.wholesale_attested) return { ok: false, message: "Confirm the wholesale relationship for this supplier on the Suppliers page first." };

  const rules = await loadStoreRules(ctx.store.id);
  if (targetMargin < rules.minNetMarginPct) {
    const msg = `Target margin can't be below your store's ${rules.minNetMarginPct}% floor.`;
    return { ok: false, message: msg, fieldErrors: { targetMargin: msg } };
  }

  const { items, errors } = source === "links" ? parseLinks(input, supplier.adapter) : parseCsvItems(input);
  if (errors.length) {
    return { ok: false, message: `Fix these ${errors.length === 1 ? "line" : "lines"} and submit again:\n${formatLineErrors(errors)}`, fieldErrors: { input: "Some lines need fixing." } };
  }
  if (items.length === 0) return { ok: false, message: "Nothing to add.", fieldErrors: { input: "Add at least one product." } };

  try {
    await assertWithinLimit(ctx.org.id, "listings", items.length);
  } catch (e) {
    if (e instanceof PlanLimitError) return { ok: false, message: e.message };
    throw e;
  }

  const { data: job, error } = await supabase
    .from("bulk_jobs")
    .insert({
      org_id: ctx.org.id,
      store_id: ctx.store.id,
      created_by: ctx.user.id,
      mode,
      source,
      supplier_id: supplier.id,
      target_margin_pct: targetMargin,
      total: items.length,
    })
    .select("id")
    .single();
  if (error || !job) return { ok: false, message: "Couldn't start the batch. Please try again." };

  const { error: itemsErr } = await supabase
    .from("bulk_job_items")
    .insert(items.map((input, position) => ({ job_id: job.id, org_id: ctx.org.id, input, position })));
  if (itemsErr) {
    await supabase.from("bulk_jobs").update({ status: "failed" }).eq("id", job.id);
    return { ok: false, message: "Couldn't save the batch items. Please try again." };
  }

  try {
    await inngest.send({ name: EVENTS.bulkJobCreated, data: { jobId: job.id, storeId: ctx.store.id } });
  } catch {
    await supabase.from("bulk_jobs").update({ status: "failed" }).eq("id", job.id);
    return { ok: false, message: "The background worker didn't accept the batch. Please try again in a minute." };
  }
  redirect(`/app/listings/jobs/${job.id}`);
}
