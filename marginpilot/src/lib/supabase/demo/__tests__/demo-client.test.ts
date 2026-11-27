import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createDemoClient } from "../client";
import { DEMO_IDS } from "../seed";
import { schema } from "../schema";

beforeAll(() => {
  process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
});

describe("demo schema", () => {
  it("reads defaults and primary keys from the migrations", () => {
    const listings = schema().get("listings")!;
    expect(listings.columns.find((c) => c.name === "status")!.def()).toBe("draft");
    expect(listings.columns.find((c) => c.name === "vero_flags")!.def()).toEqual([]);
    expect(schema().get("store_rules")!.columns.find((c) => c.name === "shipping_regions")!.def()).toEqual(["US"]);
    expect(schema().get("referral_clicks")!.pk).toEqual(["code", "day"]);
    expect(schema().get("activity_log")!.identity).toBe("id");
  });
});

describe("demo client", () => {
  const db = createDemoClient();

  it("resolves many-to-one, one-to-many and count embeds", async () => {
    const { data: m } = await db.from("memberships").select("role, org_id, organizations(id, name, plan)").eq("user_id", DEMO_IDS.user);
    expect(m).toEqual([{ role: "owner", org_id: DEMO_IDS.org, organizations: { id: DEMO_IDS.org, name: "Demo Seller Store", plan: "mentorship" } }]);
    const { data: orgs } = await db.from("organizations").select("id, memberships(count)").eq("id", DEMO_IDS.org).single();
    expect(orgs).toEqual({ id: DEMO_IDS.org, memberships: [{ count: 2 }] });
    const { data: order } = await db.from("orders").select("id, lines:order_lines(quantity)").eq("id", DEMO_IDS.order(1)).single();
    expect((order as { lines: unknown[] }).lines.length).toBeGreaterThan(0);
  });

  it("filters on embedded tables with !inner", async () => {
    const { data } = await db.from("monitor_proposals").select("id, listings!inner(store_id)").eq("listings.store_id", DEMO_IDS.store2);
    expect(data).toEqual([]);
    const { data: all } = await db.from("monitor_proposals").select("id, listings!inner(store_id)").eq("listings.store_id", DEMO_IDS.store);
    expect(all!.length).toBe(7);
  });

  it("supports or(), not(), range, count and single semantics", async () => {
    const { data, count } = await db
      .from("listings")
      .select("id, title", { count: "exact" })
      .or("title.ilike.%bowl%,sku.ilike.%025%")
      .order("title")
      .range(0, 0);
    expect(count).toBe(2);
    expect(data).toHaveLength(1);
    const { count: c2 } = await db.from("orders").select("id", { count: "exact", head: true }).not("status", "in", "(new,shipped)");
    expect(c2).toBe(7);
    const none = await db.from("listings").select("id").eq("id", "nope").single();
    expect(none.error?.code).toBe("PGRST116");
    const maybe = await db.from("listings").select("id").eq("id", "nope").maybeSingle();
    expect(maybe).toMatchObject({ data: null, error: null });
  });

  it("inserts with defaults, upserts on conflict and updates with returning", async () => {
    const { data: row } = await db.from("activity_log").insert({ org_id: DEMO_IDS.org, actor: "user", entity_type: "listing", action: "x" }).select("id, undoable").single();
    expect(row).toMatchObject({ undoable: false });
    expect(typeof (row as { id: number }).id).toBe("number");
    await db.from("store_rules").upsert({ store_id: DEMO_IDS.store, min_net_margin_pct: 25 }, { onConflict: "store_id" });
    const { data: rules } = await db.from("store_rules").select("min_net_margin_pct, handling_days").eq("store_id", DEMO_IDS.store).single();
    expect(rules).toEqual({ min_net_margin_pct: 25, handling_days: 2 });
    const { data: upd, count } = await db.from("feature_flags").update({ enabled: true }, { count: "exact" }).eq("key", "bulk_lister.v2").select("key, enabled");
    expect(count).toBe(1);
    expect(upd).toEqual([{ key: "bulk_lister.v2", enabled: true }]);
  });

  it("reads JSON paths in selects and filters", async () => {
    const { data } = await db.from("promotions").select("id, pct:config->percentOff").eq("config->>percentOff", "10");
    expect(data).toEqual([expect.objectContaining({ pct: 10 })]);
  });
});
