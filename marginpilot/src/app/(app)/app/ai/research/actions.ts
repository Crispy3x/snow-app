"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStore } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { extractSources, runAi } from "@/lib/ai/run";
import { isUuid, setAiDraftStatus } from "@/lib/ai-tools/drafts";
import {
  RESEARCH_SYSTEM,
  ResearchStructureSchema,
  STRUCTURE_SYSTEM,
  buildResearchPrompt,
  loadOwnSalesContext,
  researchWebSearchTool,
} from "@/lib/ai-tools/research";
import type { ActionState } from "@/components/ui/form";

const optionalNumber = (min: number, max: number) =>
  z.preprocess((v) => (v === "" || v == null ? undefined : Number(v)), z.number().min(min).max(max).optional());

const Input = z
  .object({
    query: z.string().trim().min(2, "Enter a niche or keyword").max(200),
    priceMin: optionalNumber(0, 100000),
    priceMax: optionalNumber(0, 100000),
    targetMargin: optionalNumber(1, 90),
  })
  .refine((v) => v.priceMin === undefined || v.priceMax === undefined || v.priceMin <= v.priceMax, {
    path: ["priceMax"],
    message: "Max price must be at least the min price",
  });

export async function runResearch(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireStore();
  const parsed = Input.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of parsed.error.issues) fieldErrors[String(i.path[0])] = i.message;
    return { ok: false, message: "Check the highlighted fields.", fieldErrors };
  }
  const input = parsed.data;
  const own = await loadOwnSalesContext(ctx.org.id, ctx.store.id);

  const res = await runAi({
    orgId: ctx.org.id,
    userId: ctx.user.id,
    storeId: ctx.store.id,
    tool: "research",
    system: RESEARCH_SYSTEM,
    messages: [{ role: "user", content: buildResearchPrompt({ ...input, own }) }],
    tools: [researchWebSearchTool()],
    maxTokens: 12000,
  });
  if (!res.ok) return { ok: false, message: res.message };

  const sources = extractSources(res.content);

  // Cheap structuring pass (bulk tier, no extra credits). If it fails, the free-text report still shows.
  const structured = await runAi({
    orgId: ctx.org.id,
    userId: ctx.user.id,
    storeId: ctx.store.id,
    tool: "research",
    tier: "bulk",
    credits: 0,
    system: STRUCTURE_SYSTEM,
    messages: [{ role: "user", content: res.text.slice(0, 30000) }],
    schema: ResearchStructureSchema,
    maxTokens: 4000,
    effort: "low",
  });

  const db = createAdminClient();
  const { data, error } = await db
    .from("research_runs")
    .insert({
      org_id: ctx.org.id,
      store_id: ctx.store.id,
      user_id: ctx.user.id,
      query: input.query,
      price_min: input.priceMin ?? null,
      price_max: input.priceMax ?? null,
      target_margin_pct: input.targetMargin ?? null,
      report: res.text,
      structured: structured.ok ? structured.output : null,
      sources,
      own_data: own,
      ai_request_id: res.requestId || null,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, message: "The research finished but couldn't be saved. Please try again." };
  revalidatePath("/app/ai/research");
  redirect(`/app/ai/research?run=${data.id}`);
}

export async function setResearchStatus(formData: FormData) {
  const ctx = await requireStore();
  const id = formData.get("runId");
  const status = formData.get("status");
  if (!isUuid(id) || (status !== "approved" && status !== "rejected")) return;
  const db = createAdminClient();
  const { data } = await db
    .from("research_runs")
    .update({ draft_status: status })
    .eq("id", id)
    .eq("org_id", ctx.org.id)
    .select("ai_request_id")
    .maybeSingle();
  if (data) await setAiDraftStatus(ctx.org.id, data.ai_request_id, status);
  revalidatePath("/app/ai/research");
}
