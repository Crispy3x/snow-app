import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CHAT_TOOL_DEFS, runChatTool, type ChatScope } from "../chat-tools";

type Call = { table: string; select?: string; filters: [string, string, unknown][] };

/** Minimal stand-in for the Supabase query builder that records every filter. */
function fakeDb(tables: Record<string, unknown[]>) {
  const calls: Call[] = [];
  const db = {
    from(table: string) {
      const call: Call = { table, filters: [] };
      calls.push(call);
      const result = () => ({ data: tables[table] ?? [], error: null });
      const chain: Record<string, unknown> = {
        select(s: string) {
          call.select = s;
          return chain;
        },
        then(resolve: (v: unknown) => void) {
          resolve(result());
        },
        maybeSingle: async () => ({ data: (tables[table] ?? [])[0] ?? null, error: null }),
      };
      for (const op of ["eq", "neq", "ilike", "gte", "lte", "in", "or", "order", "limit"]) {
        chain[op] = (col: string, val?: unknown) => {
          call.filters.push([op, col, val]);
          return chain;
        };
      }
      return chain;
    },
  };
  return { db: db as unknown as SupabaseClient, calls };
}

const scope: ChatScope = { orgId: "org-1", storeId: "store-1", userId: "user-1", hasCourseAccess: false };
const rulesRow = {
  store_id: "store-1",
  min_net_margin_pct: "20",
  final_value_fee_pct: "13.6",
  per_order_fee: "0.40",
  tax_on_cost_pct: "0",
  sale_discount_pct: "0",
  min_price: "0",
  ad_rate_tiers: [],
  handling_days: 2,
};
const listing = (id: string, price: number, cost: number | null, extra: Record<string, unknown> = {}) => ({
  id,
  sku: `SKU-${id}`,
  title: `Item ${id}`,
  price: String(price),
  quantity: 3,
  status: "active",
  views: 10,
  sold: 1,
  watchers: 0,
  listed_at: "2026-10-01T00:00:00Z",
  created_at: "2026-10-01T00:00:00Z",
  net_margin_pct: null,
  supplier_products: cost === null ? null : { cost: String(cost), shipping_cost: "0" },
  ...extra,
});

const has = (c: Call, op: string, col: string, val: unknown) => c.filters.some(([o, k, v]) => o === op && k === col && v === val);

describe("chat tool argument validation", () => {
  it("rejects org_id / store_id arguments (strict schemas) without touching the database", async () => {
    const { db, calls } = fakeDb({});
    const out = JSON.parse(await runChatTool(db, scope, "listings_query", { org_id: "org-2", margin_below: 25 }));
    expect(out.error).toMatch(/Invalid arguments/);
    expect(calls).toHaveLength(0);
    const out2 = JSON.parse(await runChatTool(db, scope, "orders_summary", { from: "2026-01-01", to: "2026-01-31", store_id: "store-2" }));
    expect(out2.error).toMatch(/Invalid arguments/);
    expect(calls).toHaveLength(0);
  });

  it("validates dates, ranges and limits", async () => {
    const { db } = fakeDb({});
    expect(JSON.parse(await runChatTool(db, scope, "metrics", { from: "Jan 1", to: "2026-01-31" })).error).toMatch(/YYYY-MM-DD/);
    expect(JSON.parse(await runChatTool(db, scope, "metrics", { from: "2026-02-01", to: "2026-01-01" })).error).toMatch(/on or before/);
    expect(JSON.parse(await runChatTool(db, scope, "listings_query", { limit: 500 })).error).toMatch(/limit/);
    expect(JSON.parse(await runChatTool(db, scope, "course_search", { query: "a" })).error).toMatch(/query/);
    expect(JSON.parse(await runChatTool(db, scope, "drop_tables", {})).error).toMatch(/Unknown tool/);
  });

  it("exposes a definition for every tool", () => {
    expect(CHAT_TOOL_DEFS.map((d) => d.name).sort()).toEqual(["course_search", "listings_query", "metrics", "orders_summary", "rules_get"]);
  });
});

describe("org and store scoping", () => {
  it("pins every query to the session org and store", async () => {
    const { db, calls } = fakeDb({ store_rules: [rulesRow], listings: [], orders: [], store_daily_metrics: [] });
    await runChatTool(db, scope, "listings_query", {});
    await runChatTool(db, scope, "orders_summary", { from: "2026-10-01", to: "2026-10-31" });
    await runChatTool(db, scope, "metrics", { from: "2026-10-01", to: "2026-10-31" });
    await runChatTool(db, scope, "rules_get", {});
    expect(calls.length).toBeGreaterThanOrEqual(5);
    for (const c of calls) {
      if (c.table === "store_rules") {
        expect(has(c, "eq", "store_id", "store-1")).toBe(true);
        expect(has(c, "eq", "ebay_stores.org_id", "org-1")).toBe(true);
      } else {
        expect(has(c, "eq", "org_id", "org-1")).toBe(true);
        expect(has(c, "eq", "store_id", "store-1")).toBe(true);
      }
    }
  });

  it("never selects buyer names, usernames or addresses from orders", async () => {
    const { db, calls } = fakeDb({ orders: [] });
    await runChatTool(db, scope, "orders_summary", { from: "2026-10-01", to: "2026-10-31" });
    const sel = calls.find((c) => c.table === "orders")!.select!;
    expect(sel).not.toMatch(/buyer|ship_to/);
  });
});

describe("listings_query", () => {
  it("answers 'which listings are under 25% margin?' with the margin engine", async () => {
    const { db } = fakeDb({
      store_rules: [rulesRow],
      // margins at 13.6% FVF + $0.40: $20 / $12 cost -> 24.4%; $30 / $12 -> 44.7%; $15 / $11 -> 11.1%; unknown cost excluded
      listings: [listing("a", 20, 12), listing("b", 30, 12), listing("c", 15, 11), listing("d", 25, null)],
    });
    const out = JSON.parse(await runChatTool(db, scope, "listings_query", { margin_below: 25 }));
    expect(out.matched).toBe(2);
    expect(out.listings.map((l: { id: string }) => l.id)).toEqual(["c", "a"]); // lowest margin first
    expect(out.listings[1].net_margin_pct).toBe(24.4);
    expect(out.listings[1].passes_margin_floor).toBe(true);
    expect(out.listings[0].passes_margin_floor).toBe(false);
    expect(out.listings[0].url).toBe("/app/listings/c");
  });
});

describe("course_search", () => {
  it("says the course isn't in the plan and skips the query without access", async () => {
    const { db, calls } = fakeDb({});
    const out = JSON.parse(await runChatTool(db, scope, "course_search", { query: "pricing" }));
    expect(out.not_in_plan).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it("searches published lessons with a sanitised term when the user has access", async () => {
    const { db, calls } = fakeDb({ course_lessons: [{ title: "Pricing basics", slug: "pricing-basics", summary: "s", body: "All about pricing your items." }] });
    const out = JSON.parse(await runChatTool(db, { ...scope, hasCourseAccess: true }, "course_search", { query: "pricing),id.eq.1" }));
    expect(out.lessons[0].url).toBe("/app/course/pricing-basics");
    const c = calls[0];
    expect(has(c, "eq", "is_published", true)).toBe(true);
    const or = c.filters.find(([o]) => o === "or")![1];
    expect(or).not.toMatch(/\)|,id\.eq/);
  });
});
