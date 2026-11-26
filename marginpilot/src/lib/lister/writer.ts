import "server-only";
import { z } from "zod";
import { runAi } from "@/lib/ai/run";
import type { SupplierProduct } from "@/lib/suppliers";
import { sanitizeDescription, sanitizeTitle, htmlToText } from "./text";
import { checkVero, combineVero, type VeroResult } from "./vero";

/**
 * AI listing writer (tool "listing_writer"). Turns supplier data into an eBay
 * draft: search-optimised title, clean description, item specifics and a VeRO
 * risk view. Output is always a draft for the seller to approve; the code-side
 * sanitizers and VeRO brand list run on every result regardless of the model.
 *
 * Item specifics come back as [{name, values}] because structured outputs need
 * closed objects (no free-form records); they are turned into a record here.
 */

export const listingDraftSchema = z.object({
  title: z.string().describe("eBay title, at most 80 characters"),
  description: z.string().describe("Simple HTML: <p>, <ul>/<li>, <strong> only"),
  itemSpecifics: z.array(z.object({ name: z.string(), values: z.array(z.string()) })),
  vero: z.object({
    risk: z.enum(["none", "low", "high"]),
    brandsMentioned: z.array(z.string()),
    reasons: z.array(z.string()),
  }),
});
export type ListingDraftOutput = z.infer<typeof listingDraftSchema>;

export type ListingDraft = {
  title: string;
  description: string;
  itemSpecifics: Record<string, string[]>;
  vero: VeroResult;
};

export const WRITER_SYSTEM = `You write eBay listings for a seller who drop ships from WHOLESALE suppliers.
Return a draft the seller will review.

Title (max 80 characters, aim for 65-80):
- Lead with brand (only if the supplier states a real brand the seller carries), then product type, then key attributes buyers search for (material, size, colour, quantity, compatible model).
- No ALL CAPS words except standard acronyms (USB, LED). No symbols like ! * ~ # or emoji. No keyword stuffing or repeated words.
- Never include supplier promo words: sale, hot, discount, % off, coupon, free shipping, wholesale, factory, new arrival, best seller, cheap.

Description:
- Clean, factual, scannable: a short opening paragraph, then a <ul> of key features and specs, then what's included.
- Only <p>, <ul>, <li>, <strong>, <br>. No styles, scripts, images or links.
- Remove supplier coupons, "hot sale" lines, prices, shipping-time promises, external links, website names, emails, phone numbers, WhatsApp/WeChat or any contact info.
- Don't invent specs. If something isn't in the source, leave it out.

Item specifics: eBay-style names (Brand, Type, Material, Color, Size, Model, Features, Room, Style...). Use "Unbranded" for Brand when no real brand is given. Values short (under 65 characters).

VeRO (eBay Verified Rights Owner) risk:
- "high" when the text names a well-known brand or trademark the seller may not be authorised to sell, or suggests replicas ("inspired by", "dupe", "AAA quality").
- "low" for "compatible with <Brand>" / "fits <Brand>" phrasing or trademark symbols.
- "none" otherwise. List every brand or trademarked term you saw in brandsMentioned, and explain in reasons.
- Don't add brand names to the title or specifics that the supplier didn't state, and keep "compatible with" brands out of the first words of the title.`;

function productPrompt(input: { product?: SupplierProduct; rawText?: string }): string {
  if (input.product) {
    const p = input.product;
    return JSON.stringify(
      {
        supplier_title: p.title,
        supplier_description: htmlToText(p.description).slice(0, 6000),
        brand: p.brand,
        attributes: p.attributes,
        supplier_category: p.category,
      },
      null,
      2,
    );
  }
  return (input.rawText ?? "").slice(0, 8000);
}

/** Merge AI specifics with supplier attributes, tidy and cap to what eBay accepts. */
export function buildSpecifics(ai: ListingDraftOutput["itemSpecifics"], attributes: Record<string, string> = {}, brand?: string | null): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const add = (name: string, values: string[]) => {
    const n = name.trim().slice(0, 65);
    const vals = [...new Set(values.map((v) => v.trim().slice(0, 65)).filter(Boolean))].slice(0, 10);
    if (!n || !vals.length) return;
    const key = Object.keys(out).find((k) => k.toLowerCase() === n.toLowerCase()) ?? n;
    if (!out[key]) out[key] = vals;
  };
  for (const s of ai) add(s.name, s.values);
  for (const [k, v] of Object.entries(attributes)) add(k, [v]);
  if (brand) add("Brand", [brand]);
  if (!Object.keys(out).some((k) => k.toLowerCase() === "brand")) out.Brand = ["Unbranded"];
  return Object.fromEntries(Object.entries(out).slice(0, 30));
}

export function finishDraft(out: ListingDraftOutput, input: { product?: SupplierProduct; rawText?: string }): ListingDraft {
  const title = sanitizeTitle(out.title) || sanitizeTitle(input.product?.title ?? "") || "Untitled item";
  const description = sanitizeDescription(out.description || input.product?.description || "");
  const itemSpecifics = buildSpecifics(out.itemSpecifics, input.product?.attributes, input.product?.brand);
  const blob = [title, htmlToText(description), ...Object.entries(itemSpecifics).map(([k, v]) => `${k}: ${v.join(", ")}`), input.product?.title ?? "", input.rawText ?? ""].join("\n");
  const vero = combineVero(out.vero, checkVero(blob));
  return { title, description, itemSpecifics, vero };
}

export async function writeListing(opts: {
  orgId: string;
  userId: string | null;
  storeId: string | null;
  input: { product?: SupplierProduct; rawText?: string };
  bulk?: boolean;
}): Promise<{ ok: true; draft: ListingDraft; requestId: string } | { ok: false; message: string; requestId?: string }> {
  const res = await runAi({
    orgId: opts.orgId,
    userId: opts.userId,
    storeId: opts.storeId,
    tool: "listing_writer",
    bulk: opts.bulk,
    system: WRITER_SYSTEM,
    messages: [
      {
        role: "user",
        content: `Write the eBay listing draft for this supplier product.\n\n<supplier_product>\n${productPrompt(opts.input)}\n</supplier_product>`,
      },
    ],
    schema: listingDraftSchema,
    maxTokens: 3000,
    effort: opts.bulk ? "low" : "medium",
  });
  if (!res.ok) return { ok: false, message: res.message, requestId: res.requestId };
  return { ok: true, draft: finishDraft(res.output, opts.input), requestId: res.requestId };
}
