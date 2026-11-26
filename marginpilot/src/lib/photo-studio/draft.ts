import { z } from "zod";
import { guardPrice, type GuardResult, type GuardRules } from "@/lib/margin";
import { priceListing } from "@/lib/lister/pricing";
import { htmlToText, sanitizeDescription, sanitizeTitle, TITLE_MAX } from "@/lib/lister/text";
import { checkVero, combineVero, type VeroResult } from "@/lib/lister/vero";
import { buildSpecifics } from "@/lib/lister/writer";

/**
 * Photo studio drafts: the structured output Claude returns for a product photo,
 * the code-side clean-up applied to it (same sanitizers and VeRO check as the
 * listing writer), and the mapping from an approved draft to a listings row.
 * Everything here is pure so it can be unit tested.
 */

export const CONDITIONS = ["New", "New other (see details)", "Used", "For parts or not working", "Unclear from photo"] as const;
export type ConditionGuess = (typeof CONDITIONS)[number];

export const photoDraftSchema = z.object({
  productSummary: z.string().describe("One sentence: what the product is, as seen in the photo"),
  title: z.string().describe("eBay title, at most 80 characters"),
  description: z.string().describe("Simple HTML: <p>, <ul>/<li>, <strong> only"),
  itemSpecifics: z.array(z.object({ name: z.string(), values: z.array(z.string()) })),
  categoryKeywords: z.array(z.string()).describe("3-6 short phrases to search eBay's category picker with, most specific first"),
  condition: z.enum(CONDITIONS),
  conditionNotes: z.string().describe("What in the photo suggests the condition; empty if nothing"),
  vero: z.object({
    risk: z.enum(["none", "low", "high"]),
    brandsMentioned: z.array(z.string()),
    reasons: z.array(z.string()),
  }),
});
export type PhotoDraftOutput = z.infer<typeof photoDraftSchema>;

export type PhotoDraft = {
  productSummary: string;
  title: string;
  description: string;
  itemSpecifics: Record<string, string[]>;
  categoryKeywords: string[];
  condition: ConditionGuess;
  conditionNotes: string;
  vero: VeroResult;
};

export const PHOTO_SYSTEM = `You write eBay listings from a single product photo for a seller who sources from WHOLESALE suppliers.
Return a draft the seller will review and edit.

Look only at what is visible. Never invent specs you can't see (exact dimensions, wattage, materials you can't tell, model numbers that aren't legible). If the seller adds notes, trust their notes over your guess.

Title (max 80 characters, aim for 65-80):
- Product type first, then the attributes buyers search for that are visible or stated: colour, material, size, quantity, style, compatible model.
- Lead with a brand ONLY if the brand is clearly printed on the product or packaging AND the seller's notes don't say it's unbranded; otherwise no brand.
- No ALL CAPS words except standard acronyms (USB, LED). No symbols like ! * ~ # or emoji. No keyword stuffing or repeated words. No promo words (sale, hot, discount, free shipping, wholesale, cheap).

Description:
- A short opening paragraph, then a <ul> of visible features, then what's included if it's clear.
- Only <p>, <ul>, <li>, <strong>, <br>. No styles, scripts, images, links, prices or shipping promises.

Item specifics: eBay-style names (Brand, Type, Color, Material, Style, Features, Size, Room, Model...). Use "Unbranded" for Brand when no real brand is visible or stated. Values short (under 65 characters). Only include values you can see or the seller stated.

Category keywords: 3-6 short phrases a seller would type into eBay's category search, most specific first (e.g. "garlic press", "kitchen utensils").

Condition: your best guess from the photo (tags, packaging, wear). Use "Unclear from photo" when you can't tell, and say why in conditionNotes.

VeRO (eBay Verified Rights Owner) risk:
- "high" when a well-known brand, logo or character is visible or named and the seller may not be authorised to sell it, or the item looks like a replica.
- "low" for "compatible with <Brand>" items or visible trademark symbols.
- "none" otherwise. List every brand, logo or character you saw in brandsMentioned and explain in reasons.`;

export function photoPrompt(input: { notes?: string; cost?: number | null }): string {
  const notes = (input.notes ?? "").trim().slice(0, 2000);
  return [
    "Write the eBay listing draft for the product in this photo.",
    notes ? `\n<seller_notes>\n${notes}\n</seller_notes>` : "\nThe seller added no notes.",
  ].join("\n");
}

/** Code-side clean-up and VeRO merge on every model result. */
export function finishPhotoDraft(out: PhotoDraftOutput, input: { notes?: string } = {}): PhotoDraft {
  const title = sanitizeTitle(out.title) || sanitizeTitle(out.productSummary) || "Untitled item";
  const description = sanitizeDescription(out.description || `<p>${out.productSummary}</p>`);
  const itemSpecifics = buildSpecifics(out.itemSpecifics);
  const categoryKeywords = [...new Set(out.categoryKeywords.map((k) => k.trim().replace(/\s+/g, " ").slice(0, 60)).filter(Boolean))].slice(0, 6);
  const blob = [title, htmlToText(description), ...Object.entries(itemSpecifics).map(([k, v]) => `${k}: ${v.join(", ")}`), input.notes ?? ""].join("\n");
  const vero = combineVero(out.vero, checkVero(blob));
  return {
    productSummary: out.productSummary.trim().slice(0, 300),
    title,
    description,
    itemSpecifics,
    categoryKeywords,
    condition: out.condition,
    conditionNotes: out.conditionNotes.trim().slice(0, 500),
    vero,
  };
}

/** Price at the store's margin floor, when a cost is known. */
export function floorPrice(cost: number | null, shipping: number | null, rules: GuardRules): { price: number | null; reasons: string[] } {
  if (cost === null || !Number.isFinite(cost) || cost < 0) return { price: null, reasons: [] };
  const r = priceListing(rules.minNetMarginPct, { supplierCost: cost, supplierShipping: shipping ?? 0 }, rules);
  return { price: r.price, reasons: r.ok ? [] : r.reasons };
}

/** Parse "Name: value, value" lines (or a JSON record) into item specifics. */
export function parseSpecifics(raw: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const add = (k: string, vals: string[]) => {
    const key = k.trim().slice(0, 65);
    const v = [...new Set(vals.map((s) => String(s).trim().slice(0, 65)).filter(Boolean))].slice(0, 10);
    if (key && v.length && Object.keys(out).length < 30) out[key] = v;
  };
  const text = raw.trim();
  if (text.startsWith("{")) {
    try {
      for (const [k, v] of Object.entries(JSON.parse(text) as Record<string, unknown>)) if (Array.isArray(v)) add(k, v.map(String));
      return out;
    } catch {
      return out;
    }
  }
  for (const line of text.split("\n")) {
    const i = line.indexOf(":");
    if (i <= 0) continue;
    add(line.slice(0, i), line.slice(i + 1).split(","));
  }
  return out;
}

export type ListingInput = {
  title: string;
  description: string;
  specifics: Record<string, string[]>;
  price: number | null;
  cost: number | null;
  shipping: number | null;
  quantity: number;
};

export const NO_COST_REASON = "No item cost entered, so the margin wasn't checked. Add the cost on the listing before publishing.";

export type ListingRowResult =
  | { ok: true; row: Record<string, unknown>; guard: GuardResult | null; vero: VeroResult; price: number }
  | { ok: false; message: string };

/**
 * Map an approved photo-studio draft to a listings insert. The price is the
 * seller's, or the margin-floor price when they left it blank and gave a cost.
 * The margin guard runs whenever a cost is known; a failing guard saves the
 * listing as blocked_margin with the reasons, like the listing writer does.
 */
export function buildListingRow(args: {
  id: string;
  orgId: string;
  storeId: string;
  sku: string;
  input: ListingInput;
  images: string[];
  rules: GuardRules;
  aiVero?: VeroResult | null;
}): ListingRowResult {
  const { input, rules } = args;
  const title = sanitizeTitle(input.title).slice(0, TITLE_MAX);
  if (title.length < 10) return { ok: false, message: "Titles need at least 10 characters." };
  const description = sanitizeDescription(input.description);
  if (!htmlToText(description).trim()) return { ok: false, message: "Add a description." };
  const cost = input.cost !== null && Number.isFinite(input.cost) && input.cost >= 0 ? input.cost : null;
  const shipping = cost !== null ? Math.max(0, input.shipping ?? 0) : null;

  let price = input.price !== null && Number.isFinite(input.price) && input.price > 0 ? input.price : null;
  if (price === null && cost !== null) price = floorPrice(cost, shipping, rules).price;
  if (price === null) return { ok: false, message: cost === null ? "Enter a price, or your item cost so we can price it at your margin floor." : "No price can reach your margin floor with these costs. Enter a price." };
  price = Math.round(price * 100) / 100;

  const guard = cost !== null ? guardPrice(price, { supplierCost: cost, supplierShipping: shipping ?? 0 }, rules) : null;
  const specificsText = Object.entries(input.specifics).map(([k, v]) => `${k}: ${v.join(", ")}`).join("\n");
  const codeVero = checkVero(`${title}\n${htmlToText(description)}\n${specificsText}`);
  const vero = args.aiVero ? combineVero(args.aiVero, codeVero) : codeVero;
  const blocked = guard !== null && !guard.ok;

  return {
    ok: true,
    price,
    guard,
    vero,
    row: {
      id: args.id,
      org_id: args.orgId,
      store_id: args.storeId,
      sku: args.sku,
      title,
      description,
      item_specifics: input.specifics,
      images: args.images.filter((u) => /^https:\/\//.test(u)).slice(0, 24),
      price,
      quantity: Math.max(0, Math.min(10_000, Math.trunc(input.quantity))),
      status: blocked ? "blocked_margin" : "draft",
      net_margin_pct: guard ? guard.breakdown.marginPct : null,
      margin_reasons: blocked ? guard!.reasons : [],
      last_error: blocked ? guard!.reasons.join(" ") : null,
      manual_cost: cost,
      manual_shipping_cost: shipping,
      vero_risk: vero.risk,
      vero_flags: vero.reasons,
    },
  };
}
