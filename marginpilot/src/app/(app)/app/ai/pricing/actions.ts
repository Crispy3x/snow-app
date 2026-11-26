"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStore } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { runAi } from "@/lib/ai/run";
import { guardPrice, type MarginBreakdown } from "@/lib/margin";
import { loadStoreRules } from "@/lib/ai-tools/audit-run";
import { isUuid, setAiDraftStatus } from "@/lib/ai-tools/drafts";
import {
  PRICING_SYSTEM,
  PricingAdviceSchema,
  buildPricingPrompt,
  clampRecommendation,
  computePricingFacts,
  type CompetitorPrice,
  type PricingFacts,
} from "@/lib/ai-tools/pricing";

export type PricingResult = {
  requestId: string;
  facts: PricingFacts;
  aiPrice: number;
  price: number;
  clamped: boolean;
  rationale: string;
  risks: string[];
  breakdown: MarginBreakdown;
  passes: boolean;
  listing: { id: string; title: string; status: string; price: number } | null;
};

export type PricingState = { ok?: boolean; message?: string; fieldErrors?: Record<string, string>; result?: PricingResult; facts?: PricingFacts } | null;

const money = z.preprocess((v) => (v === "" || v == null ? undefined : Number(v)), z.number().min(0).max(100000).optional());

export async function runPricing(_prev: PricingState, formData: FormData): Promise<PricingState> {
  const ctx = await requireStore();
  const db = createAdminClient();
  const fieldErrors: Record<string, string> = {};

  const listingId = String(formData.get("listingId") ?? "");
  const costIn = money.safeParse(formData.get("cost"));
  const shipIn = money.safeParse(formData.get("shipping"));
  if (!costIn.success) fieldErrors.cost = "Enter a cost of 0 or more";
  if (!shipIn.success) fieldErrors.shipping = "Enter shipping of 0 or more";

  let listing: PricingResult["listing"] = null;
  let cost = costIn.success ? costIn.data : undefined;
  let shipping = shipIn.success ? shipIn.data : undefined;
  if (listingId) {
    if (!isUuid(listingId)) return { ok: false, message: "Pick a listing from the list." };
    const { data } = await db
      .from("listings")
      .select("id, title, status, price, supplier_products(cost, shipping_cost)")
      .eq("id", listingId)
      .eq("org_id", ctx.org.id)
      .eq("store_id", ctx.store.id)
      .maybeSingle();
    if (!data) return { ok: false, message: "That listing isn't in the current store." };
    const sp = data.supplier_products as unknown as { cost: number | null; shipping_cost: number | null } | null;
    listing = { id: data.id, title: data.title, status: data.status, price: Number(data.price) };
    if (cost === undefined && sp?.cost != null) cost = Number(sp.cost);
    if (shipping === undefined && sp?.shipping_cost != null) shipping = Number(sp.shipping_cost);
  }
  if (cost === undefined && !fieldErrors.cost) fieldErrors.cost = listing ? "This listing has no supplier cost. Enter it here." : "Enter the supplier cost or pick a listing";

  // Competitor rows the seller typed in. No eBay data is fetched (eBay API License: no price modelling from eBay content).
  const labels = formData.getAll("comp_label").map(String);
  const prices = formData.getAll("comp_price").map(String);
  const ships = formData.getAll("comp_shipping").map(String);
  const competitors: CompetitorPrice[] = [];
  prices.forEach((p, i) => {
    if (!p.trim() && !(labels[i] ?? "").trim()) return;
    const price = Number(p);
    const ship = ships[i]?.trim() ? Number(ships[i]) : 0;
    if (!(price > 0) || price > 100000 || !(ship >= 0)) {
      fieldErrors[`comp_${i}`] = "Enter a price above 0 and shipping of 0 or more";
      return;
    }
    competitors.push({ label: (labels[i] ?? "").trim().slice(0, 60) || `Competitor ${i + 1}`, price, shipping: ship });
  });
  if (competitors.length > 20) fieldErrors.comp_0 = "Up to 20 competitor prices";

  if (Object.keys(fieldErrors).length || cost === undefined) return { ok: false, message: "Check the highlighted fields.", fieldErrors };

  const rules = await loadStoreRules(ctx.store.id);
  const costInputs = { supplierCost: cost, supplierShipping: shipping ?? 0 };
  const facts = computePricingFacts({ cost: costInputs, rules, competitors, currentPrice: listing?.price ?? null });
  if (facts.floor === null) {
    return { ok: false, facts, message: "No price can meet your margin floor with these fees. Lower the cost, or review the margin floor and ad rates in store rules." };
  }

  const res = await runAi({
    orgId: ctx.org.id,
    userId: ctx.user.id,
    storeId: ctx.store.id,
    tool: "pricing_advisor",
    system: PRICING_SYSTEM,
    messages: [{ role: "user", content: buildPricingPrompt(facts, rules, costInputs, competitors) }],
    schema: PricingAdviceSchema,
    maxTokens: 2000,
    effort: "low",
  });
  if (!res.ok) return { ok: false, facts, message: res.message };

  const clamp = clampRecommendation(res.output.recommendedPrice, facts.floor)!;
  const g = guardPrice(clamp.price, costInputs, rules);
  return {
    ok: true,
    result: {
      requestId: res.requestId,
      facts,
      aiPrice: res.output.recommendedPrice,
      price: clamp.price,
      clamped: clamp.clamped,
      rationale: res.output.rationale,
      risks: res.output.risks,
      breakdown: g.breakdown,
      passes: g.ok,
      listing,
    },
  };
}

export type DecisionState = { ok?: boolean; message?: string; status?: "approved" | "rejected" | "applied" } | null;

export async function decidePricing(_prev: DecisionState, formData: FormData): Promise<DecisionState> {
  const ctx = await requireStore();
  const requestId = formData.get("requestId");
  const decision = formData.get("decision");
  if (!isUuid(requestId)) return { ok: false, message: "Missing draft." };

  if (decision === "reject") {
    await setAiDraftStatus(ctx.org.id, requestId, "rejected");
    return { ok: true, status: "rejected", message: "Recommendation discarded." };
  }
  if (decision === "approve") {
    await setAiDraftStatus(ctx.org.id, requestId, "approved");
    return { ok: true, status: "approved", message: "Recommendation approved. Apply it from the listing page." };
  }
  if (decision === "apply_draft") {
    // Only draft listings are updated here; live listings are repriced from the listing page.
    const listingId = formData.get("listingId");
    const price = Number(formData.get("price"));
    if (!isUuid(listingId) || !(price > 0)) return { ok: false, message: "Missing listing or price." };
    const db = createAdminClient();
    const { data: l } = await db
      .from("listings")
      .select("id, status, supplier_products(cost, shipping_cost)")
      .eq("id", listingId)
      .eq("org_id", ctx.org.id)
      .eq("store_id", ctx.store.id)
      .maybeSingle();
    if (!l) return { ok: false, message: "That listing isn't in the current store." };
    if (l.status !== "draft") return { ok: false, message: "Only draft listings can be updated here. Open the listing page to reprice a live listing." };
    const sp = l.supplier_products as unknown as { cost: number | null; shipping_cost: number | null } | null;
    let marginPct: number | null = null;
    if (sp?.cost != null) {
      const rules = await loadStoreRules(ctx.store.id);
      const g = guardPrice(price, { supplierCost: Number(sp.cost), supplierShipping: Number(sp.shipping_cost ?? 0) }, rules);
      if (!g.ok) return { ok: false, message: g.reasons.join(" ") };
      marginPct = g.breakdown.marginPct;
    }
    const { error } = await db
      .from("listings")
      .update({ price, ...(marginPct !== null ? { net_margin_pct: marginPct } : {}), updated_at: new Date().toISOString() })
      .eq("id", listingId)
      .eq("org_id", ctx.org.id)
      .eq("status", "draft");
    if (error) return { ok: false, message: "Couldn't update the draft listing." };
    await setAiDraftStatus(ctx.org.id, requestId, "applied");
    revalidatePath("/app/listings");
    return { ok: true, status: "applied", message: `Draft listing price set to $${price.toFixed(2)}.` };
  }
  return { ok: false, message: "Unknown action." };
}
