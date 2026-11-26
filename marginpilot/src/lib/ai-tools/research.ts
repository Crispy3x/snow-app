import "server-only";
import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Product research. Uses Claude web search (sources shown) plus the seller's OWN
 * sales history. It does not use eBay sold-listing / Marketplace Insights data
 * (PLAN.md §4C): eBay domains are blocked from the search tool.
 */

export const EBAY_DOMAINS = ["ebay.com", "ebay.co.uk", "ebay.de", "ebay.ca", "ebay.com.au", "ebay.fr", "ebay.it", "ebay.es", "terapeak.com"];

export function researchWebSearchTool(): Anthropic.Beta.BetaToolUnion {
  return { type: "web_search_20260209", name: "web_search", max_uses: 6, blocked_domains: EBAY_DOMAINS };
}

export type OwnSalesContext = {
  windowDays: number;
  orders: number;
  topListings: { title: string; units: number; revenue: number; categoryId: string | null }[];
  topCategories: { categoryId: string; units: number; revenue: number }[];
  activeListings: number;
};

/** The seller's own best sellers and categories from their orders (last 180 days), scoped to org + store. */
export async function loadOwnSalesContext(orgId: string, storeId: string): Promise<OwnSalesContext> {
  const db = createAdminClient();
  const windowDays = 180;
  const since = new Date(Date.now() - windowDays * 86_400_000).toISOString();
  const [{ data: lines }, { count }] = await Promise.all([
    db
      .from("order_lines")
      .select("quantity, sale_price, listing_id, orders!inner(store_id, created_on_ebay), listings(title, category_id)")
      .eq("org_id", orgId)
      .eq("orders.store_id", storeId)
      .gte("orders.created_on_ebay", since)
      .limit(5000),
    db.from("listings").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("store_id", storeId).eq("status", "active"),
  ]);

  type Line = { quantity: number; sale_price: number | string; listing_id: string | null; listings: { title: string; category_id: string | null } | null };
  const rows = (lines ?? []) as unknown as Line[];
  const byListing = new Map<string, { title: string; units: number; revenue: number; categoryId: string | null }>();
  const byCat = new Map<string, { units: number; revenue: number }>();
  for (const l of rows) {
    const rev = Number(l.sale_price) * l.quantity;
    if (l.listing_id && l.listings) {
      const e = byListing.get(l.listing_id) ?? { title: l.listings.title, units: 0, revenue: 0, categoryId: l.listings.category_id };
      e.units += l.quantity;
      e.revenue += rev;
      byListing.set(l.listing_id, e);
    }
    const cat = l.listings?.category_id;
    if (cat) {
      const c = byCat.get(cat) ?? { units: 0, revenue: 0 };
      c.units += l.quantity;
      c.revenue += rev;
      byCat.set(cat, c);
    }
  }
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return {
    windowDays,
    orders: rows.length,
    activeListings: count ?? 0,
    topListings: [...byListing.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 10).map((l) => ({ ...l, revenue: r2(l.revenue) })),
    topCategories: [...byCat].sort((a, b) => b[1].revenue - a[1].revenue).slice(0, 5).map(([categoryId, c]) => ({ categoryId, units: c.units, revenue: r2(c.revenue) })),
  };
}

export const RESEARCH_SYSTEM = `You are a product research assistant for an eBay seller who sources from WHOLESALE suppliers (not retail arbitrage).
Use web search to find current demand signals (search trends, news, seasonality, category growth, wholesale/B2B supplier pricing) and cite what you find.
Rules:
- Do NOT use or estimate eBay sold-listing, completed-listing or eBay market-trend data. eBay sites are excluded from search. Don't claim eBay sales figures.
- Prefer wholesale cost information from distributor, manufacturer or B2B sources. Never suggest buying from retail marketplaces (Amazon, Walmart, AliExpress retail) to resell.
- Flag risks for every idea: VeRO / brand-owner enforcement, counterfeit risk, eBay prohibited or restricted categories (e.g. medical devices, cosmetics claims, batteries/hazmat, knives, supplements, children's products needing certification), heavy/fragile shipping, returns.
- Be honest about uncertainty; say when evidence is thin.
Structure the answer with these headings: Demand signals, Product ideas (3 to 6, each with why, rough wholesale cost range if found, risks), Fit with your store, Next steps.`;

export function buildResearchPrompt(input: { query: string; priceMin?: number | null; priceMax?: number | null; targetMargin?: number | null; own: OwnSalesContext }): string {
  const own = input.own;
  const ownText = own.orders
    ? `The seller's own sales (last ${own.windowDays} days, ${own.orders} order lines, ${own.activeListings} active listings):\nBest sellers: ${own.topListings
        .map((l) => `${l.title} (${l.units} sold, $${l.revenue})`)
        .join("; ")}\nTop eBay category ids: ${own.topCategories.map((c) => `${c.categoryId} ($${c.revenue})`).join(", ") || "n/a"}`
    : `The seller has no sales history in this store yet (${own.activeListings} active listings).`;
  return [
    `Niche or keyword: ${input.query}`,
    input.priceMin || input.priceMax
      ? `Target selling price range: ${input.priceMin ? `$${input.priceMin}` : "any"} to ${input.priceMax ? `$${input.priceMax}` : "any"}`
      : null,
    input.targetMargin ? `Target net margin after eBay fees: ${input.targetMargin}%` : null,
    ownText,
  ]
    .filter(Boolean)
    .join("\n");
}

export const ResearchStructureSchema = z.object({
  demandSummary: z.string().describe("Two to four sentences summarising demand signals"),
  ideas: z.array(
    z.object({
      name: z.string(),
      why: z.string(),
      wholesaleCostLow: z.number().nullable().describe("USD per unit, only if the report states one"),
      wholesaleCostHigh: z.number().nullable(),
      risks: z.array(z.string()),
      veroOrBrandRisk: z.boolean(),
      restrictedCategoryRisk: z.boolean(),
    }),
  ),
  cautions: z.array(z.string()).describe("General cautions from the report"),
});
export type ResearchStructure = z.infer<typeof ResearchStructureSchema>;

export const STRUCTURE_SYSTEM = `Extract the research report into the schema. Use only what the report says; use null for costs it doesn't state. Don't add ideas.`;
