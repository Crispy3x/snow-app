"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStore } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { runAi } from "@/lib/ai/run";
import { getEbayClient, EbayApiError, EbayRateLimitError } from "@/lib/ebay/client";
import { putInventoryItem } from "@/lib/ebay/api";
import { logActivity } from "@/lib/activity";
import { buildInventoryItem, LISTING_COLUMNS, type ListingRow } from "@/lib/lister/publish";
import { htmlToText, MAX_TITLE_BATCH, sanitizeTitle } from "@/lib/lister/text";
import { checkVero } from "@/lib/lister/vero";

const outputSchema = z.object({
  suggestions: z.array(z.object({ listingId: z.string(), newTitle: z.string(), reason: z.string() })),
});

export type TitleSuggestion = { listingId: string; oldTitle: string; newTitle: string; reason: string; veroWarning: string | null };
export type OptimizeState = { ok?: boolean; message?: string; requestId?: string; suggestions?: TitleSuggestion[] } | null;

const SYSTEM = `You optimise eBay listing titles for search (Cassini) and clicks.
For each listing return a new title of at most 80 characters:
- Brand first only if the item really has one (never add brands that aren't in the input), then product type, then the attributes buyers search for (material, size, colour, count, compatible model).
- Use the most-searched wording for the product type. Use the full 80 characters when there are useful attributes.
- No ALL CAPS words except standard acronyms, no symbols like ! * ~ #, no emoji, no repeated words, no promo words (sale, hot, discount, free shipping, wholesale, new arrival, best).
- Don't invent facts. Don't add "compatible with <brand>" unless the input says so.
Give a one-sentence reason per listing. Return every listingId you were given exactly once; if the title is already good, return it unchanged and say so.`;

async function storeListings(ids: string[], orgId: string, storeId: string): Promise<ListingRow[]> {
  const db = createAdminClient();
  const { data } = await db.from("listings").select(LISTING_COLUMNS).in("id", ids).eq("org_id", orgId).eq("store_id", storeId);
  return (data ?? []) as unknown as ListingRow[];
}

export async function optimizeTitles(_prev: OptimizeState, formData: FormData): Promise<OptimizeState> {
  const ctx = await requireStore();
  const ids = [...new Set(formData.getAll("listingId").map(String))].filter((id) => z.string().uuid().safeParse(id).success);
  if (ids.length === 0) return { ok: false, message: "Pick at least one listing." };
  if (ids.length > MAX_TITLE_BATCH) return { ok: false, message: `Pick up to ${MAX_TITLE_BATCH} listings per batch.` };
  const listings = await storeListings(ids, ctx.org.id, ctx.store.id);
  if (!listings.length) return { ok: false, message: "Those listings weren't found in this store." };

  const payload = listings.map((l) => ({
    listingId: l.id,
    currentTitle: l.title,
    itemSpecifics: l.item_specifics ?? {},
    description: htmlToText(l.description ?? "").slice(0, 800),
  }));
  const res = await runAi({
    orgId: ctx.org.id,
    userId: ctx.user.id,
    storeId: ctx.store.id,
    tool: "title_optimizer",
    bulk: true,
    credits: Math.max(1, Math.ceil(listings.length / 5)),
    system: SYSTEM,
    messages: [{ role: "user", content: `Optimise these titles.\n\n<listings>\n${JSON.stringify(payload, null, 1)}\n</listings>` }],
    schema: outputSchema,
    maxTokens: 4000,
    effort: "low",
  });
  if (!res.ok) return { ok: false, message: res.message };

  const byId = new Map(listings.map((l) => [l.id, l]));
  const suggestions: TitleSuggestion[] = [];
  for (const s of res.output.suggestions) {
    const l = byId.get(s.listingId);
    if (!l || suggestions.some((x) => x.listingId === l.id)) continue;
    const newTitle = sanitizeTitle(s.newTitle) || l.title;
    const before = checkVero(l.title), after = checkVero(newTitle);
    const added = after.brandsMentioned.filter((b) => !before.brandsMentioned.includes(b));
    suggestions.push({
      listingId: l.id,
      oldTitle: l.title,
      newTitle,
      reason: s.reason,
      veroWarning: added.length ? `Adds brand terms: ${added.join(", ")}` : null,
    });
  }
  return { ok: true, requestId: res.requestId, suggestions, message: `${suggestions.length} suggestions ready. Approve the ones you want.` };
}

const applySchema = z.object({
  requestId: z.string().uuid(),
  rows: z.array(z.object({ listingId: z.string().uuid(), newTitle: z.string().trim().min(10).max(80) })).min(1).max(MAX_TITLE_BATCH),
});

export async function applyTitles(input: { requestId: string; rows: { listingId: string; newTitle: string }[] }): Promise<{ ok: boolean; message: string; applied: string[] }> {
  const ctx = await requireStore();
  const parsed = applySchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Titles must be 10 to 80 characters.", applied: [] };
  const db = createAdminClient();
  const { data: req } = await db.from("ai_requests").select("id, output, tool").eq("id", parsed.data.requestId).eq("org_id", ctx.org.id).maybeSingle();
  if (!req || req.tool !== "title_optimizer") return { ok: false, message: "Those suggestions have expired. Run the optimizer again.", applied: [] };
  const allowed = new Set(((req.output as z.infer<typeof outputSchema>)?.suggestions ?? []).map((s) => s.listingId));
  const rows = parsed.data.rows.filter((r) => allowed.has(r.listingId));
  const listings = await storeListings(rows.map((r) => r.listingId), ctx.org.id, ctx.store.id);
  const byId = new Map(listings.map((l) => [l.id, l]));

  const applied: string[] = [];
  const errors: string[] = [];
  let client: Awaited<ReturnType<typeof getEbayClient>> | null = null;
  for (const r of rows) {
    const l = byId.get(r.listingId);
    if (!l) continue;
    const title = sanitizeTitle(r.newTitle);
    if (title === l.title) continue;
    const live = (l.status === "active" || l.status === "out_of_stock") && !!l.ebay_offer_id;
    if (live) {
      try {
        client ??= await getEbayClient(l.store_id);
        // Revising the inventory item updates the live listing's title.
        await putInventoryItem(client, l.sku, buildInventoryItem({ ...l, title }));
      } catch (e) {
        if (e instanceof EbayRateLimitError) {
          errors.push("eBay is rate limiting requests; the rest weren't changed. Try again in a minute.");
          break;
        }
        errors.push(`${l.sku}: ${e instanceof EbayApiError ? e.message : "eBay update failed"}`);
        continue;
      }
    }
    await db.from("listings").update({ title, updated_at: new Date().toISOString() }).eq("id", l.id).eq("org_id", ctx.org.id);
    await logActivity({
      orgId: ctx.org.id,
      storeId: l.store_id,
      actor: "user",
      userId: ctx.user.id,
      entityType: "listing",
      entityId: l.id,
      action: "title_changed",
      before: { title: l.title, sku: l.sku },
      after: { title, source: "title_optimizer" },
      undoable: live,
    });
    applied.push(l.id);
  }
  await db.from("ai_requests").update({ draft_status: applied.length ? "applied" : "rejected" }).eq("id", req.id);
  revalidatePath("/app/listings");
  revalidatePath("/app/ai/titles");
  const msg = `${applied.length} title${applied.length === 1 ? "" : "s"} updated.${errors.length ? ` ${errors.join(" ")}` : ""}`;
  return { ok: errors.length === 0, message: msg, applied };
}
