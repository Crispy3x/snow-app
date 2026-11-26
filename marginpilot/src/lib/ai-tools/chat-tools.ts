import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { guardPrice, rulesFromRow, type GuardRules } from "@/lib/margin";

/**
 * Read-only tools for the store assistant chat. Every query is pinned to the org
 * and store from the signed-in session (ChatScope), never to ids the model sends:
 * argument schemas are strict, so an org_id/store_id argument is rejected.
 * Results never include buyer names, usernames or addresses.
 */

export type ChatScope = { orgId: string; storeId: string; userId: string; hasCourseAccess: boolean };

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

export const ListingsQueryArgs = z
  .object({
    status: z.enum(["draft", "queued", "publishing", "active", "out_of_stock", "ended", "blocked_margin", "error"]).optional(),
    margin_below: z.number().min(-100).max(100).optional(),
    margin_above: z.number().min(-100).max(100).optional(),
    views_zero: z.boolean().optional(),
    no_sales: z.boolean().optional(),
    title_contains: z.string().max(80).optional(),
    sort: z.enum(["margin_asc", "margin_desc", "views_desc", "views_asc", "sold_desc", "price_desc", "price_asc", "oldest", "newest"]).optional(),
    limit: z.number().int().min(1).max(50).optional(),
  })
  .strict();

export const DateRangeArgs = z
  .object({ from: isoDate, to: isoDate })
  .strict()
  .refine((a) => a.from <= a.to, "from must be on or before to");

export const RulesArgs = z.object({}).strict();
export const CourseSearchArgs = z.object({ query: z.string().min(2).max(100), limit: z.number().int().min(1).max(10).optional() }).strict();

export const CHAT_TOOL_DEFS = [
  {
    name: "listings_query",
    description:
      "Find listings in the current store. Net margin is computed by the margin engine at the store's worst-case ad rate from supplier cost; listings with unknown cost have margin null. Use margin_below: 25 for 'under 25% margin'.",
    input_schema: {
      type: "object" as const,
      properties: {
        status: { type: "string", enum: ["draft", "queued", "publishing", "active", "out_of_stock", "ended", "blocked_margin", "error"] },
        margin_below: { type: "number", description: "Only listings with net margin % below this" },
        margin_above: { type: "number", description: "Only listings with net margin % above this" },
        views_zero: { type: "boolean", description: "Only listings with zero views" },
        no_sales: { type: "boolean", description: "Only listings with zero sales" },
        title_contains: { type: "string" },
        sort: { type: "string", enum: ["margin_asc", "margin_desc", "views_desc", "views_asc", "sold_desc", "price_desc", "price_asc", "oldest", "newest"] },
        limit: { type: "integer", minimum: 1, maximum: 50, description: "Default 20" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "orders_summary",
    description: "Order count, revenue, eBay fees, estimated profit, status counts and top SKUs for the current store in a date range (inclusive).",
    input_schema: {
      type: "object" as const,
      properties: { from: { type: "string", description: "YYYY-MM-DD" }, to: { type: "string", description: "YYYY-MM-DD" } },
      required: ["from", "to"],
      additionalProperties: false,
    },
  },
  {
    name: "metrics",
    description: "Daily store metrics (sales, orders, net profit, average margin, active listings, views) with totals for a date range.",
    input_schema: {
      type: "object" as const,
      properties: { from: { type: "string", description: "YYYY-MM-DD" }, to: { type: "string", description: "YYYY-MM-DD" } },
      required: ["from", "to"],
      additionalProperties: false,
    },
  },
  {
    name: "rules_get",
    description: "The current store's pricing and margin rules (fees, margin floor, ad rate tiers, handling time, monitor settings).",
    input_schema: { type: "object" as const, properties: {}, additionalProperties: false },
  },
  {
    name: "course_search",
    description: "Search the seller's video course lessons by keyword. Returns lesson titles, slugs and snippets, or says the course isn't in their plan.",
    input_schema: {
      type: "object" as const,
      properties: { query: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 10 } },
      required: ["query"],
      additionalProperties: false,
    },
  },
];

export type ChatToolName = "listings_query" | "orders_summary" | "metrics" | "rules_get" | "course_search";

const DEFAULT_RULES: GuardRules = { finalValueFeePct: 13.6, perOrderFee: 0.4, taxOnCostPct: 0, saleDiscountPct: 0, minNetMarginPct: 20, adRateTiers: [] };

async function loadRules(db: SupabaseClient, scope: ChatScope) {
  const { data } = await db
    .from("store_rules")
    .select("*, ebay_stores!inner(org_id)")
    .eq("store_id", scope.storeId)
    .eq("ebay_stores.org_id", scope.orgId)
    .maybeSingle();
  return data;
}

type ListingRow = {
  id: string;
  sku: string;
  title: string;
  price: number | string;
  quantity: number;
  status: string;
  views: number;
  sold: number;
  watchers: number;
  listed_at: string | null;
  created_at: string;
  net_margin_pct: number | string | null;
  supplier_products: { cost: number | string | null; shipping_cost: number | string | null } | null;
};

async function listingsQuery(db: SupabaseClient, scope: ChatScope, args: z.infer<typeof ListingsQueryArgs>) {
  const rulesRow = await loadRules(db, scope);
  const rules = rulesRow ? rulesFromRow(rulesRow) : DEFAULT_RULES;
  let q = db
    .from("listings")
    .select("id, sku, title, price, quantity, status, views, sold, watchers, listed_at, created_at, net_margin_pct, supplier_products(cost, shipping_cost)")
    .eq("org_id", scope.orgId)
    .eq("store_id", scope.storeId);
  if (args.status) q = q.eq("status", args.status);
  if (args.views_zero) q = q.eq("views", 0);
  if (args.no_sales) q = q.eq("sold", 0);
  if (args.title_contains) q = q.ilike("title", `%${args.title_contains.replace(/[%_\\,()]/g, " ")}%`);
  const { data, error } = await q.limit(2000);
  if (error) return { error: "Couldn't read listings." };

  let rows = ((data ?? []) as unknown as ListingRow[]).map((l) => {
    const price = Number(l.price);
    const sp = l.supplier_products;
    let margin: number | null = null;
    let passesFloor: boolean | null = null;
    if (sp?.cost != null && price > 0) {
      const g = guardPrice(price, { supplierCost: Number(sp.cost), supplierShipping: Number(sp.shipping_cost ?? 0) }, rules);
      margin = g.breakdown.marginPct;
      passesFloor = g.ok;
    } else if (l.net_margin_pct != null) {
      margin = Number(l.net_margin_pct);
    }
    return {
      id: l.id,
      sku: l.sku,
      title: l.title,
      price,
      quantity: l.quantity,
      status: l.status,
      views: l.views,
      sold: l.sold,
      watchers: l.watchers,
      listed: (l.listed_at ?? l.created_at).slice(0, 10),
      net_margin_pct: margin,
      passes_margin_floor: passesFloor,
      url: `/app/listings/${l.id}`,
    };
  });

  if (args.margin_below !== undefined) rows = rows.filter((r) => r.net_margin_pct !== null && r.net_margin_pct < args.margin_below!);
  if (args.margin_above !== undefined) rows = rows.filter((r) => r.net_margin_pct !== null && r.net_margin_pct > args.margin_above!);

  const nullsLast = (v: number | null, dir: 1 | -1) => (v === null ? Infinity : v * dir);
  const sorters: Record<string, (a: (typeof rows)[number], b: (typeof rows)[number]) => number> = {
    margin_asc: (a, b) => nullsLast(a.net_margin_pct, 1) - nullsLast(b.net_margin_pct, 1),
    margin_desc: (a, b) => nullsLast(a.net_margin_pct, -1) - nullsLast(b.net_margin_pct, -1),
    views_desc: (a, b) => b.views - a.views,
    views_asc: (a, b) => a.views - b.views,
    sold_desc: (a, b) => b.sold - a.sold,
    price_desc: (a, b) => b.price - a.price,
    price_asc: (a, b) => a.price - b.price,
    oldest: (a, b) => a.listed.localeCompare(b.listed),
    newest: (a, b) => b.listed.localeCompare(a.listed),
  };
  const sort = args.sort ?? (args.margin_below !== undefined ? "margin_asc" : "newest");
  rows.sort(sorters[sort]);
  const limit = args.limit ?? 20;
  return {
    matched: rows.length,
    showing: Math.min(limit, rows.length),
    margin_floor_pct: rules.minNetMarginPct,
    listings: rows.slice(0, limit),
  };
}

type OrderRow = {
  id: string;
  status: string;
  order_total: number | string | null;
  ebay_fees: number | string | null;
  created_on_ebay: string | null;
  order_lines: { sku: string | null; quantity: number; sale_price: number | string; supplier_cost: number | string | null }[];
};

async function ordersSummary(db: SupabaseClient, scope: ChatScope, args: z.infer<typeof DateRangeArgs>) {
  // Only money/status columns: no buyer_username, no ship_to.
  const { data, error } = await db
    .from("orders")
    .select("id, status, order_total, ebay_fees, created_on_ebay, order_lines(sku, quantity, sale_price, supplier_cost)")
    .eq("org_id", scope.orgId)
    .eq("store_id", scope.storeId)
    .gte("created_on_ebay", `${args.from}T00:00:00Z`)
    .lte("created_on_ebay", `${args.to}T23:59:59Z`)
    .limit(5000);
  if (error) return { error: "Couldn't read orders." };
  const orders = (data ?? []) as unknown as OrderRow[];
  const byStatus: Record<string, number> = {};
  const bySku = new Map<string, { units: number; revenue: number }>();
  let revenue = 0, fees = 0, cost = 0, unknownCostLines = 0;
  for (const o of orders) {
    byStatus[o.status] = (byStatus[o.status] ?? 0) + 1;
    revenue += Number(o.order_total ?? 0);
    fees += Number(o.ebay_fees ?? 0);
    for (const l of o.order_lines ?? []) {
      if (l.supplier_cost == null) unknownCostLines++;
      else cost += Number(l.supplier_cost) * l.quantity;
      const k = l.sku ?? "(no sku)";
      const s = bySku.get(k) ?? { units: 0, revenue: 0 };
      s.units += l.quantity;
      s.revenue += Number(l.sale_price) * l.quantity;
      bySku.set(k, s);
    }
  }
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return {
    from: args.from,
    to: args.to,
    orders: orders.length,
    revenue: r2(revenue),
    ebay_fees: r2(fees),
    supplier_cost: r2(cost),
    estimated_profit: r2(revenue - fees - cost),
    lines_with_unknown_cost: unknownCostLines,
    by_status: byStatus,
    top_skus: [...bySku].sort((a, b) => b[1].revenue - a[1].revenue).slice(0, 10).map(([sku, s]) => ({ sku, units: s.units, revenue: r2(s.revenue) })),
  };
}

async function metrics(db: SupabaseClient, scope: ChatScope, args: z.infer<typeof DateRangeArgs>) {
  const { data, error } = await db
    .from("store_daily_metrics")
    .select("day, sales, orders, net_profit, avg_margin_pct, active_listings, views")
    .eq("org_id", scope.orgId)
    .eq("store_id", scope.storeId)
    .gte("day", args.from)
    .lte("day", args.to)
    .order("day")
    .limit(400);
  if (error) return { error: "Couldn't read metrics." };
  const days = (data ?? []).map((d) => ({
    day: d.day as string,
    sales: Number(d.sales),
    orders: d.orders as number,
    net_profit: Number(d.net_profit),
    avg_margin_pct: d.avg_margin_pct === null ? null : Number(d.avg_margin_pct),
    active_listings: d.active_listings as number,
    views: d.views as number,
  }));
  const sum = (k: "sales" | "orders" | "net_profit" | "views") => Math.round(days.reduce((s, d) => s + d[k], 0) * 100) / 100;
  return {
    from: args.from,
    to: args.to,
    totals: { sales: sum("sales"), orders: sum("orders"), net_profit: sum("net_profit"), views: sum("views") },
    days: days.length > 62 ? days.filter((_, i) => i % 7 === 0) : days,
    note: days.length > 62 ? "Showing every 7th day; totals cover the whole range." : undefined,
  };
}

async function rulesGet(db: SupabaseClient, scope: ChatScope) {
  const r = await loadRules(db, scope);
  if (!r) return { note: "This store has no saved rules yet; defaults apply (13.6% final value fee, $0.40 per order, 20% margin floor)." };
  return {
    min_net_margin_pct: Number(r.min_net_margin_pct),
    final_value_fee_pct: Number(r.final_value_fee_pct),
    per_order_fee: Number(r.per_order_fee),
    tax_on_cost_pct: Number(r.tax_on_cost_pct),
    sale_discount_pct: Number(r.sale_discount_pct),
    min_price: Number(r.min_price),
    handling_days: r.handling_days,
    shipping_regions: r.shipping_regions,
    ad_rate_tiers: r.ad_rate_tiers,
    monitor_action: r.monitor_action,
    monitor_interval_hours: r.monitor_interval_hours,
    reprice_requires_approval: r.reprice_requires_approval,
    offer_margin_pct: r.offer_margin_pct === null ? null : Number(r.offer_margin_pct),
    cleanup_after_days: r.cleanup_after_days,
  };
}

async function courseSearch(db: SupabaseClient, scope: ChatScope, args: z.infer<typeof CourseSearchArgs>) {
  if (!scope.hasCourseAccess) {
    return { not_in_plan: true, message: "The video course isn't included in this account's plan. It's part of Professional and Mentorship, or can be bought separately." };
  }
  const term = args.query.replace(/[%_\\,().*]/g, " ").trim();
  if (term.length < 2) return { lessons: [] };
  const { data, error } = await db
    .from("course_lessons")
    .select("title, slug, summary, body")
    .eq("is_published", true)
    .or(`title.ilike.%${term}%,summary.ilike.%${term}%,body.ilike.%${term}%`)
    .order("position")
    .limit(args.limit ?? 5);
  if (error) return { error: "Couldn't search the course." };
  return {
    lessons: (data ?? []).map((l) => {
      const body = (l.body as string | null) ?? "";
      const at = body.toLowerCase().indexOf(term.toLowerCase());
      return {
        title: l.title,
        url: `/app/course/${l.slug}`,
        summary: l.summary,
        snippet: at >= 0 ? body.slice(Math.max(0, at - 200), at + 400) : body.slice(0, 400),
      };
    }),
  };
}

const err = (message: string) => JSON.stringify({ error: message });

/** Validates the model's arguments and runs one tool, scoped to `scope`. Always returns a JSON string. */
export async function runChatTool(db: SupabaseClient, scope: ChatScope, name: string, input: unknown): Promise<string> {
  const parse = <T extends z.ZodType>(schema: T) => {
    const r = schema.safeParse(input ?? {});
    return r.success ? { ok: true as const, data: r.data as z.infer<T> } : { ok: false as const, message: r.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ") };
  };
  switch (name as ChatToolName) {
    case "listings_query": {
      const a = parse(ListingsQueryArgs);
      return a.ok ? JSON.stringify(await listingsQuery(db, scope, a.data)) : err(`Invalid arguments: ${a.message}`);
    }
    case "orders_summary": {
      const a = parse(DateRangeArgs);
      return a.ok ? JSON.stringify(await ordersSummary(db, scope, a.data)) : err(`Invalid arguments: ${a.message}`);
    }
    case "metrics": {
      const a = parse(DateRangeArgs);
      return a.ok ? JSON.stringify(await metrics(db, scope, a.data)) : err(`Invalid arguments: ${a.message}`);
    }
    case "rules_get": {
      const a = parse(RulesArgs);
      return a.ok ? JSON.stringify(await rulesGet(db, scope)) : err(`Invalid arguments: ${a.message}`);
    }
    case "course_search": {
      const a = parse(CourseSearchArgs);
      return a.ok ? JSON.stringify(await courseSearch(db, scope, a.data)) : err(`Invalid arguments: ${a.message}`);
    }
    default:
      return err(`Unknown tool ${name}`);
  }
}

export function chatSystemPrompt(opts: { today: string; storeLabel: string; marketplace: string }): string {
  return `You are the store assistant inside MarginPilot, an eBay seller tool. Today is ${opts.today}. The seller's current store is "${opts.storeLabel}" (${opts.marketplace}).
Answer questions about this store using the tools; they only return this store's data. Don't guess numbers: look them up. If a tool returns an error, say what went wrong.
Margins come from the margin engine at the worst-case ad rate; say so when you quote them. When listing items, give the title, price and margin, and link to /app/listings/<id> using markdown links.
You can't change anything (prices, listings, messages); point the seller to the right page instead (e.g. /app/ai/pricing, /app/listings/<id>, /app/settings).
You have no buyer personal data and no eBay market or sold-item data. Keep answers short and practical.`;
}
