/**
 * AI model routing, prices and credit costs. Prices checked against Anthropic's
 * published rates (Nov 2026), in USD per million tokens.
 */

export type ModelTier = "bulk" | "standard" | "deep";

export const MODELS: Record<ModelTier, string> = {
  bulk: process.env.AI_MODEL_BULK || "claude-haiku-5-5",
  standard: process.env.AI_MODEL_STANDARD || "claude-sonnet-5-5",
  deep: process.env.AI_MODEL_DEEP || "claude-opus-5-5",
};

export const MODEL_PRICES: Record<string, { input: number; output: number; cacheRead: number }> = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.1 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
};

/** Models that accept the server-side refusal fallback (`fallbacks: "default"`). */
export const FALLBACK_MODELS = new Set(["claude-sonnet-5-5", "claude-opus-5-5"]);

export type AiToolKey =
  | "listing_writer"
  | "title_optimizer"
  | "research"
  | "pricing_advisor"
  | "image_cleaner"
  | "buyer_message"
  | "listing_audit"
  | "store_chat"
  | "photo_studio";

/** Credits charged per successful call, and which tier each tool uses. */
export const AI_TOOLS: Record<AiToolKey, { label: string; tier: ModelTier; bulkTier?: ModelTier; credits: number }> = {
  listing_writer: { label: "Listing writer", tier: "standard", bulkTier: "bulk", credits: 2 },
  title_optimizer: { label: "Title optimizer", tier: "bulk", credits: 1 },
  research: { label: "Product research", tier: "deep", credits: 10 },
  pricing_advisor: { label: "Pricing advisor", tier: "standard", credits: 2 },
  image_cleaner: { label: "Image cleaner", tier: "bulk", credits: 1 },
  buyer_message: { label: "Buyer message assistant", tier: "standard", credits: 2 },
  listing_audit: { label: "Listing audit", tier: "standard", credits: 5 },
  store_chat: { label: "Store assistant chat", tier: "deep", credits: 3 },
  photo_studio: { label: "Photo studio", tier: "standard", credits: 3 },
};

export function estimateCostUsd(model: string, usage: { input: number; output: number; cacheRead?: number }): number {
  const p = MODEL_PRICES[model];
  if (!p) return 0;
  return (usage.input * p.input + usage.output * p.output + (usage.cacheRead ?? 0) * p.cacheRead) / 1_000_000;
}
