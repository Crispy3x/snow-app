import "server-only";
import { encrypt, encryptJson } from "@/lib/crypto";
import { COURSE_MODULES } from "@/content/marketing";
import type { Row } from "./query";

/**
 * Sample data for demo mode. Store data only: no testimonials, proof
 * screenshots, directory suppliers, mentorship sessions/feedback or referral
 * earnings (those pages show their real empty states). Ids are fixed so
 * dynamic routes can be opened directly, e.g. /app/listings/<DEMO_IDS.listing(1)>.
 */
const id = (kind: number, n: number) => `de${String(kind).padStart(6, "0")}-0000-4000-8000-${String(n).padStart(12, "0")}`;

export const DEMO_IDS = {
  user: id(1, 1),
  teammate: id(1, 2),
  org: id(2, 1),
  org2: id(2, 2),
  store: id(3, 1),
  store2: id(3, 2),
  supplier: id(4, 1),
  product: (n: number) => id(5, n),
  listing: (n: number) => id(6, n),
  order: (n: number) => id(7, n),
  bulkJob: id(8, 1),
  auditRun: id(9, 1),
  researchRun: id(10, 1),
  chatThread: id(11, 1),
  aiRequest: (n: number) => id(12, n),
  module: (n: number) => id(13, n),
  lesson: (n: number) => id(14, n),
};

export const DEMO_USER = { id: DEMO_IDS.user, email: "demo@marginpilot.test", fullName: "Demo Seller" };

const PRODUCTS = [
  "Bamboo Cutting Board Set of 3", "Stainless Steel Mixing Bowls 5 Piece", "Silicone Baking Mat 2 Pack", "Glass Food Storage Containers 10 Piece",
  "Cast Iron Trivet Round", "Microfiber Cleaning Cloths 24 Pack", "Collapsible Laundry Basket", "Over Door Shoe Organizer 24 Pocket",
  "LED Under Cabinet Light Bar", "Ceramic Planter with Drainage 6 inch", "Cotton Rope Storage Basket Large", "Magnetic Knife Strip 16 inch",
  "Adjustable Drawer Dividers 4 Pack", "Stainless Steel Soap Dispenser", "Non Slip Velvet Hangers 50 Pack", "Waterproof Shower Curtain Liner",
  "Spice Jars with Labels 12 Pack", "Wooden Wall Shelf Floating 24 inch", "Reusable Produce Bags 9 Pack", "Electric Milk Frother Handheld",
  "Kitchen Timer Digital Magnetic", "Acrylic Makeup Organizer", "Door Draft Stopper 36 inch", "Linen Table Runner 72 inch", "Pet Hair Remover Roller",
];
const STATUSES = [
  "active", "active", "active", "active", "active", "active", "active", "active", "active", "active", "active", "active",
  "draft", "draft", "draft", "blocked_margin", "blocked_margin", "out_of_stock", "out_of_stock", "ended", "error",
  "active", "active", "draft", "out_of_stock",
];

function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function placeholderImage(label: string, hue = 150): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600"><rect width="600" height="600" fill="hsl(${hue} 25% 88%)"/><text x="300" y="300" font-family="sans-serif" font-size="30" text-anchor="middle" fill="hsl(${hue} 20% 30%)">${label.replace(/[<&>]/g, "")}</text><text x="300" y="345" font-family="sans-serif" font-size="20" text-anchor="middle" fill="hsl(${hue} 15% 40%)">Sample image</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export function seed(insert: (table: string, rows: Row[]) => void) {
  const rand = rng(42);
  const now = Date.now();
  const ago = (days: number, hours = 0) => new Date(now - days * 86_400_000 - hours * 3_600_000).toISOString();
  const ahead = (days: number) => new Date(now + days * 86_400_000).toISOString();
  const round = (n: number) => Math.round(n * 100) / 100;
  const { user, teammate, org, org2, store, store2, supplier } = DEMO_IDS;

  // --- people and workspaces -------------------------------------------------
  insert("auth_users", [
    { id: user, email: DEMO_USER.email },
    { id: teammate, email: "teammate@example.test" },
  ]);
  insert("organizations", [
    { id: org, name: "Demo Seller Store", owner_id: user, plan: "mentorship", stripe_customer_id: "cus_demo", created_at: ago(120) },
    { id: org2, name: "Sample Workspace", owner_id: teammate, plan: "starter", created_at: ago(30) },
  ]);
  insert("profiles", [
    { id: user, full_name: DEMO_USER.fullName, is_admin: true, current_org_id: org, current_store_id: store, onboarding: { connected_ebay: true, set_rules: true, first_batch: true }, created_at: ago(120) },
    { id: teammate, full_name: "Sample Teammate", current_org_id: org, created_at: ago(30) },
  ]);
  insert("memberships", [
    { org_id: org, user_id: user, role: "owner", created_at: ago(120) },
    { org_id: org, user_id: teammate, role: "member", created_at: ago(30) },
    { org_id: org2, user_id: teammate, role: "owner", created_at: ago(30) },
  ]);
  insert("invitations", [
    { org_id: org, email: "new.hire@example.test", role: "member", token_hash: "demo-token-hash", invited_by: user, expires_at: ahead(5), created_at: ago(2) },
  ]);
  insert("subscriptions", [
    { id: "sub_demo", org_id: org, price_id: "price_demo_mentorship", plan: "mentorship", status: "active", current_period_end: ahead(18), sale_discount: true, updated_at: ago(12) },
    { id: "sub_demo_2", org_id: org2, price_id: "price_demo_starter", plan: "starter", status: "trialing", trial_end: ahead(4), current_period_end: ahead(4), updated_at: ago(3) },
  ]);
  insert("referral_codes", [{ user_id: user, code: "DEMO7K2P" }]);
  insert("feature_flags", [
    { key: "bulk_lister.v2", enabled: false, description: "New bulk lister pipeline (sample flag)", org_allowlist: [org] },
    { key: "dashboard.forecast", enabled: true, description: "Sales forecast card on the dashboard (sample flag)" },
  ]);

  // --- stores ----------------------------------------------------------------
  const token = encrypt("demo-token-not-real");
  const storeRow = (sid: string, label: string, username: string, days: number) => ({
    id: sid, org_id: org, ebay_user_id: `demo-${username}`, ebay_username: username, marketplace_id: "EBAY_US", label, status: "active",
    access_token_enc: token, refresh_token_enc: token, access_expires_at: ago(1), refresh_expires_at: ahead(400),
    scopes: ["https://api.ebay.com/oauth/api_scope/sell.inventory", "https://api.ebay.com/oauth/api_scope/commerce.message"],
    selling_limit_amount: 25000, selling_limit_quantity: 500, connected_at: ago(days),
  });
  insert("ebay_stores", [storeRow(store, "Main store", "demo_seller_us", 120), storeRow(store2, "Home goods", "demo_home_goods", 45)]);
  const rules = {
    min_net_margin_pct: 20, sale_discount_pct: 10, min_price: 9.99, offer_margin_pct: 15, cleanup_after_days: 60,
    ad_rate_tiers: [
      { min_price: 0, max_price: 25, min_rate: 2, max_rate: 6 },
      { min_price: 25, max_price: null, min_rate: 3, max_rate: 8 },
    ],
  };
  insert("store_rules", [{ store_id: store, ...rules }, { store_id: store2, ...rules, cleanup_after_days: null }]);
  const settings = { org_id: org, fulfillment_policy_id: "demo-fulfillment", payment_policy_id: "demo-payment", return_policy_id: "demo-return", merchant_location_key: "demo-warehouse", location_postal_code: "10001", location_country: "US" };
  insert("store_settings", [{ store_id: store, ...settings }, { store_id: store2, ...settings }]);
  insert("store_automation", [
    { store_id: store, org_id: org, monitor_last_checked_at: ago(0, 3), orders_synced_at: ago(0, 1), cleanup_last_run_at: ago(1) },
    { store_id: store2, org_id: org, monitor_last_checked_at: ago(0, 5), orders_synced_at: ago(0, 2) },
  ]);

  // --- supplier, products, listings -----------------------------------------
  insert("suppliers", [{ id: supplier, org_id: org, adapter: "mock", name: "Sample Wholesale (mock feed)", wholesale_attested: true, created_at: ago(110) }]);
  const listings: Row[] = [];
  insert(
    "supplier_products",
    PRODUCTS.map((title, i) => {
      const n = i + 1;
      const cost = round(4 + rand() * 22);
      const shipping = round(rand() < 0.4 ? 0 : 2 + rand() * 4);
      const status = STATUSES[i];
      const price = round(status === "blocked_margin" ? (cost + shipping) * 1.25 : (cost + shipping) * (1.6 + rand() * 0.6));
      const margin = round(((price * (1 - 0.136) - 0.4 - cost - shipping) / price) * 100);
      const live = ["active", "out_of_stock", "ended"].includes(status);
      listings.push({
        id: DEMO_IDS.listing(n), org_id: org, store_id: n > 22 ? store2 : store, supplier_product_id: DEMO_IDS.product(n),
        sku: `MP-DEMO-${String(n).padStart(3, "0")}`, title, description: `<p>${title}. Sample listing description for the demo.</p>`,
        category_id: String(20625 + (n % 5)), item_specifics: { Brand: ["Unbranded"], Type: [title.split(" ").slice(-2).join(" ")] },
        images: [placeholderImage(title.split(" ").slice(0, 3).join(" "), (n * 37) % 360)], price, quantity: status === "out_of_stock" ? 0 : 3 + (n % 6),
        status, net_margin_pct: margin, ad_rate_pct: status === "active" ? 4 : null,
        ebay_offer_id: live ? `demo-offer-${n}` : null, ebay_listing_id: live ? String(395000000000 + n * 7919) : null,
        views: live ? Math.floor(40 + rand() * 900) : 0, sold: live ? Math.floor(rand() * 40) : 0, watchers: live ? Math.floor(rand() * 25) : 0,
        listed_at: live ? ago(10 + n * 3) : null, ended_at: status === "ended" ? ago(4) : null,
        last_error: status === "blocked_margin" ? `Net margin ${margin}% is below your 20% minimum.` : status === "error" ? "eBay rejected the listing: item specific Brand is required (sample error)." : null,
        vero_risk: n === 7 ? "low" : "none", vero_flags: n === 7 ? ["Title mentions a brand-like word: check you may sell it"] : [],
        sale_promotion_id: n <= 3 ? "demo-sale-1" : null, created_at: ago(12 + n * 3), updated_at: ago(n % 7),
      });
      return {
        id: DEMO_IDS.product(n), org_id: org, supplier_id: supplier, external_id: `demo-${String(n).padStart(3, "0")}`,
        source_url: `https://mock-supplier.test/p/demo-${String(n).padStart(3, "0")}`, title, cost, shipping_cost: shipping,
        stock: status === "out_of_stock" ? 0 : Math.floor(5 + rand() * 120), images: listings[listings.length - 1].images, last_checked_at: ago(0, 3),
      };
    }),
  );
  insert("listings", listings);
  const L = (n: number) => listings[n - 1];

  // --- 90 days of metrics ------------------------------------------------------
  const metrics: Row[] = [];
  for (const [sid, scale] of [[store, 1], [store2, 0.35]] as const) {
    for (let d = 89; d >= 0; d--) {
      const day = new Date(now - d * 86_400_000).toISOString().slice(0, 10);
      const weekday = new Date(day).getUTCDay();
      const base = (8 + (89 - d) * 0.08) * (weekday === 0 || weekday === 6 ? 1.3 : 1) * scale;
      const orders = Math.max(0, Math.round(base + (rand() - 0.5) * 5 * scale));
      const sales = round(orders * (24 + rand() * 12));
      const marginPct = round(21 + rand() * 9);
      metrics.push({ store_id: sid, org_id: org, day, sales, orders, net_profit: round((sales * marginPct) / 100), avg_margin_pct: orders ? marginPct : null, active_listings: Math.round(14 * scale + (89 - d) / 10), views: Math.round(orders * (30 + rand() * 25)) });
    }
  }
  insert("store_daily_metrics", metrics);

  // --- orders ------------------------------------------------------------------
  const orderStatuses = ["new", "new", "new", "ordered_from_supplier", "ordered_from_supplier", "shipped", "shipped", "tracking_posted", "tracking_posted", "tracking_posted", "cancelled", "returned"];
  const orders: Row[] = [];
  const lines: Row[] = [];
  const fulfillments: Row[] = [];
  orderStatuses.forEach((status, i) => {
    const n = i + 1;
    const created = i * 1.5 + 0.2;
    const a = L((i % 12) + 1);
    const b = i % 3 === 0 ? L(((i + 5) % 12) + 1) : null;
    const qa = 1 + (i % 2);
    const total = round(Number(a.price) * qa + (b ? Number(b.price) : 0));
    orders.push({
      id: DEMO_IDS.order(n), org_id: org, store_id: store, ebay_order_id: `DEMO-${10 + n}-${12000 + n * 37}`, status, order_total: total, ebay_fees: round(total * 0.136 + 0.4),
      buyer_username: `sample_buyer_${String(n).padStart(2, "0")}`,
      ship_to_enc: encryptJson({ name: `Sample Buyer ${n}`, addressLine1: `${100 + n} Example Street`, city: "Springfield", stateOrProvince: "IL", postalCode: "62701", countryCode: "US" }),
      ship_by: new Date(now - created * 86_400_000 + (i === 0 ? 0.5 : 2) * 86_400_000).toISOString(), pii_purge_after: ahead(60), created_on_ebay: ago(created), created_at: ago(created),
    });
    const supplierCost = (l: Row) => {
      const p = Number(l.price) / 1.9;
      return round(p);
    };
    lines.push({ order_id: DEMO_IDS.order(n), org_id: org, ebay_line_item_id: `demo-line-${n}-1`, listing_id: a.id, sku: a.sku, quantity: qa, sale_price: a.price, supplier_cost: supplierCost(a) });
    if (b) lines.push({ order_id: DEMO_IDS.order(n), org_id: org, ebay_line_item_id: `demo-line-${n}-2`, listing_id: b.id, sku: b.sku, quantity: 1, sale_price: b.price, supplier_cost: supplierCost(b) });
    if (status === "shipped" || status === "tracking_posted") {
      fulfillments.push({ order_id: DEMO_IDS.order(n), org_id: org, carrier: "USPS", tracking_number: `9400 0000 0000 0000 ${String(n).padStart(4, "0")}`, posted_at: status === "tracking_posted" ? ago(created - 1) : null, created_by: user, created_at: ago(created - 1) });
    }
  });
  insert("orders", orders);
  insert("order_lines", lines);
  insert("fulfillments", fulfillments);

  // --- automation: proposals, cleanup, promotions, activity --------------------
  const proposal = (n: number, action: string, status: string, extra: Row, daysAgo: number) => ({
    org_id: org, listing_id: L(n).id, action, status, old_cost: round(Number(L(n).price) / 2), old_stock: 40, old_price: L(n).price,
    margin_before_pct: L(n).net_margin_pct, created_at: ago(daysAgo), decided_at: status === "pending" ? null : ago(daysAgo - 0.5), decided_by: status === "pending" ? null : user, ...extra,
  });
  insert("monitor_proposals", [
    proposal(2, "reprice", "pending", { new_cost: round(Number(L(2).price) / 2 + 1.8), new_stock: 38, proposed_price: round(Number(L(2).price) + 3.5), margin_after_pct: 21.4, reason: "Supplier cost went up $1.80; new price keeps your 20% minimum margin." }, 0.3),
    proposal(5, "reprice", "pending", { new_cost: round(Number(L(5).price) / 2 + 0.9), new_stock: 12, proposed_price: round(Number(L(5).price) + 1.75), margin_after_pct: 20.6, reason: "Supplier cost went up $0.90." }, 0.6),
    proposal(9, "out_of_stock", "pending", { new_cost: round(Number(L(9).price) / 2), new_stock: 0, proposed_price: null, reason: "Supplier shows 0 in stock: set eBay quantity to 0." }, 1),
    proposal(11, "flag", "pending", { new_cost: round(Number(L(11).price) / 2 + 4), new_stock: 22, proposed_price: null, margin_after_pct: 12.1, reason: "Cost rise would push the price above your max; review manually." }, 1.2),
    proposal(3, "reprice", "applied", { new_cost: round(Number(L(3).price) / 2 + 1), new_stock: 30, proposed_price: round(Number(L(3).price) + 2), margin_after_pct: 22, reason: "Supplier cost went up $1.00." }, 4),
    proposal(6, "reprice", "dismissed", { new_cost: round(Number(L(6).price) / 2 - 0.5), new_stock: 60, proposed_price: round(Number(L(6).price) - 1), margin_after_pct: 24, reason: "Supplier cost dropped $0.50." }, 6),
    proposal(8, "out_of_stock", "approved", { new_cost: round(Number(L(8).price) / 2), new_stock: 0, proposed_price: null, reason: "Supplier shows 0 in stock." }, 8),
  ]);
  insert("cleanup_candidates", [
    { org_id: org, listing_id: L(10).id, reason: "No sales in 60 days and fewer than 50 views.", replacement_supplier_product_id: DEMO_IDS.product(14), status: "pending", created_at: ago(1) },
    { org_id: org, listing_id: L(12).id, reason: "No sales in 60 days.", status: "pending", created_at: ago(1) },
    { org_id: org, listing_id: L(4).id, reason: "No sales in 60 days.", status: "dismissed", created_at: ago(9) },
  ]);
  insert("promotions", [
    { org_id: org, store_id: store, kind: "sale_event", ebay_id: "demo-sale-1", name: "Weekend 10% off (sample)", config: { percentOff: 10, listingIds: [L(1).id, L(2).id, L(3).id] }, starts_at: ago(2), ends_at: ahead(5), status: "running", created_at: ago(3) },
    { org_id: org, store_id: store, kind: "sale_event", name: "Spring clearance (sample)", config: { percentOff: 15, listingIds: [] }, starts_at: ago(40), ends_at: ago(33), status: "ended", created_at: ago(41) },
  ]);
  insert("watcher_offers", [{ org_id: org, listing_id: L(1).id, offer_price: round(Number(L(1).price) * 0.92), net_margin_pct: 18.5, message: "Thanks for watching: here's a small discount.", ebay_offer_ids: ["demo-wo-1"], created_at: ago(2) }]);
  const act = (daysAgo: number, actor: string, entity_type: string, entity_id: unknown, action: string, before: Row | null, after: Row | null, undoable = false) => ({
    org_id: org, store_id: store, actor, user_id: actor === "user" ? user : null, entity_type, entity_id, action, before, after, undoable, created_at: ago(daysAgo),
  });
  insert("activity_log", [
    act(0.1, "automation", "listing", L(3).id, "price_changed", { price: round(Number(L(3).price) - 2) }, { price: L(3).price }, true),
    act(0.4, "automation", "listing", L(18).id, "quantity_set", { quantity: 5 }, { quantity: 0 }, true),
    act(0.9, "user", "order", DEMO_IDS.order(8), "tracking_posted", null, { carrier: "USPS" }),
    act(1.2, "automation", "offer", L(1).id, "offer_sent", null, { offer_price: round(Number(L(1).price) * 0.92), watchers: L(1).watchers }),
    act(1.5, "user", "rules", store, "rules_updated", { min_net_margin_pct: 18 }, { min_net_margin_pct: 20 }),
    act(2, "automation", "promotion", "demo-sale-1", "sale_created", null, { percentOff: 10, listings: 3 }),
    act(3, "user", "listing", L(20).id, "listing_ended", { status: "active" }, { status: "ended" }, true),
    act(4, "user", "listing", L(2).id, "title_changed", { title: "Mixing Bowls 5pc" }, { title: L(2).title }),
    act(5, "automation", "listing", L(6).id, "price_changed", { price: round(Number(L(6).price) + 1) }, { price: L(6).price }, true),
    act(7, "user", "listing", L(1).id, "listing_published", null, { status: "active" }),
  ]);

  // --- AI history ----------------------------------------------------------------
  const MODELS: Record<string, [string, number]> = {
    listing_writer: ["claude-sonnet-5-5", 2], title_optimizer: ["claude-haiku-5-5", 1], research: ["claude-opus-5-5", 10], pricing_advisor: ["claude-sonnet-5-5", 2],
    image_cleaner: ["claude-sonnet-5-5", 2], buyer_message: ["claude-sonnet-5-5", 1], listing_audit: ["claude-haiku-5-5", 1], store_chat: ["claude-sonnet-5-5", 1],
  };
  const tools = Object.keys(MODELS);
  const ai: Row[] = [];
  const ledger: Row[] = [];
  for (let n = 1; n <= 36; n++) {
    const tool = tools[n % tools.length];
    const [model, credits] = MODELS[tool];
    const status = n % 11 === 0 ? "error" : n % 17 === 0 ? "rate_limited" : "ok";
    const input = Math.floor(800 + rand() * 4000);
    const output = Math.floor(200 + rand() * 1500);
    const created = ago(n * 0.7, n % 5);
    ai.push({
      id: DEMO_IDS.aiRequest(n), org_id: n % 9 === 0 ? org2 : org, user_id: n % 9 === 0 ? teammate : n % 4 === 0 ? teammate : user, store_id: n % 9 === 0 ? null : store,
      tool, model, prompt: { system: `Sample ${tool.replace(/_/g, " ")} prompt`, messages: [{ role: "user", content: `Sample request ${n}` }] },
      output: status === "ok" ? { text: `Sample ${tool.replace(/_/g, " ")} output ${n}.` } : null, input_tokens: input, output_tokens: output, cache_read_tokens: Math.floor(input * 0.3),
      cost_usd: Number(((input * 3 + output * 15) / 1_000_000).toFixed(5)), credits: status === "ok" ? credits : 0, status, error: status === "error" ? "Sample upstream error" : status === "rate_limited" ? "Rate limited (sample)" : null,
      draft_status: status !== "ok" ? "rejected" : n % 3 === 0 ? "applied" : n % 3 === 1 ? "approved" : "draft", created_at: created,
    });
    if (status === "ok") ledger.push({ org_id: ai[ai.length - 1].org_id, period_start: created.slice(0, 8) + "01", delta: -credits, reason: tool, ai_request_id: DEMO_IDS.aiRequest(n), created_at: created });
  }
  insert("ai_requests", ai);
  insert("ai_credit_ledger", ledger);

  insert("audit_runs", [{ id: DEMO_IDS.auditRun, org_id: org, store_id: store, requested_by: user, status: "done", total_listings: 12, analyzed: 6, ai_request_ids: [DEMO_IDS.aiRequest(6)], created_at: ago(2), finished_at: ago(2, -1) }]);
  insert(
    "audit_items",
    [1, 2, 4, 6, 9, 10, 11, 12].map((n, i) => {
      const l = L(n);
      const recs = ["keep", "fix", "reprice", "fix", "end", "end", null, null] as const;
      return {
        run_id: DEMO_IDS.auditRun, org_id: org, store_id: store, listing_id: l.id, title: l.title, score: [88, 62, 55, 58, 24, 30, 71, 66][i],
        metrics: { price: l.price, views: l.views, sold: l.sold, watchers: l.watchers, ageDays: 10 + n * 3, titleLength: String(l.title).length, itemSpecificsCount: 2, imageCount: 1, marginPct: l.net_margin_pct, marginOk: Number(l.net_margin_pct) >= 20, floorPrice: round(Number(l.price) * 0.85), veroFlags: [] },
        issues: i === 0 ? [] : ["Only 1 photo", "Few item specifics"], recommendation: recs[i], reasons: recs[i] ? ["Sample reason based on views and sales"] : [],
        suggested_changes: recs[i] === "fix" ? { title: `${l.title} - Durable, Easy Clean`, notes: "Add 4+ photos and item specifics." } : recs[i] === "reprice" ? { price: round(Number(l.price) * 0.93) } : null,
        draft_status: "draft", ai_request_id: recs[i] ? DEMO_IDS.aiRequest(6) : null, created_at: ago(2),
      };
    }),
  );
  insert("research_runs", [
    {
      id: DEMO_IDS.researchRun, org_id: org, store_id: store, user_id: user, query: "kitchen organization under $40", price_min: 15, price_max: 40, target_margin_pct: 22,
      report: "Sample research report. Demand for drawer and pantry organizers stays steady year round, with peaks in January. (This is demo text, not real research.)",
      structured: {
        demandSummary: "Sample summary: organizers sell steadily; bundles of several pieces do better than singles.",
        ideas: [
          { name: "Stackable pantry bins (sample)", why: "Steady searches, many sold listings in the range.", wholesaleCostLow: 6, wholesaleCostHigh: 9, risks: ["Bulky to ship"], veroOrBrandRisk: false, restrictedCategoryRisk: false },
          { name: "Expandable drawer organizer (sample)", why: "Complements your existing bestsellers.", wholesaleCostLow: 7.5, wholesaleCostHigh: null, risks: [], veroOrBrandRisk: false, restrictedCategoryRisk: false },
        ],
        cautions: ["Sample caution: check supplier stock levels before listing in bulk."],
      },
      sources: [], own_data: { windowDays: 180, orders: 412, topListings: [{ title: L(1).title, units: 48, revenue: 1210.5, categoryId: "20625" }], topCategories: [{ categoryId: "20625", units: 160, revenue: 4120 }], activeListings: 14 },
      ai_request_id: DEMO_IDS.aiRequest(3), draft_status: "draft", created_at: ago(1),
    },
  ]);
  insert("chat_threads", [
    {
      id: DEMO_IDS.chatThread, org_id: org, user_id: user, store_id: store, title: "Which listings need attention?", created_at: ago(1),
      messages: [
        { role: "user", content: "Which listings need attention this week?", at: ago(1) },
        { role: "assistant", content: "Sample answer: 3 listings are blocked by your margin rule and 2 are out of stock at the supplier. Open the Monitor page to review the price proposals.", at: ago(1), requestId: DEMO_IDS.aiRequest(8), status: "draft" },
      ],
    },
  ]);
  insert("message_drafts", [
    { org_id: org, store_id: store, ebay_conversation_id: "demo-conv-1", buyer_message: "Hi, when will my order ship?", draft: "Hi! Thanks for your order. It ships within 2 business days and you'll get tracking as soon as it does. (Sample draft)", status: "draft", ai_request_id: DEMO_IDS.aiRequest(6), created_at: ago(0.5) },
  ]);

  insert("bulk_jobs", [{ id: DEMO_IDS.bulkJob, org_id: org, store_id: store, created_by: user, mode: "draft", source: "links", supplier_id: supplier, target_margin_pct: 22, status: "done", total: 5, succeeded: 4, failed: 1, created_at: ago(3), finished_at: ago(3, -0.2) }]);
  insert(
    "bulk_job_items",
    [13, 14, 15, 24, 0].map((n, i) => ({
      job_id: DEMO_IDS.bulkJob, org_id: org, position: i, input: { kind: "link", ref: n ? `https://mock-supplier.test/p/demo-${String(n).padStart(3, "0")}` : "https://mock-supplier.test/p/missing" },
      listing_id: n ? L(n).id : null, status: n ? "done" : "failed", error: n ? null : "Supplier product not found (sample error).",
    })),
  );

  // --- course: the six modules, two clearly-labelled sample lessons each -----------
  insert("course_modules", COURSE_MODULES.map((m, i) => ({ id: DEMO_IDS.module(i + 1), title: m.title, summary: m.body, position: i + 1 })));
  const lessons: Row[] = [];
  COURSE_MODULES.forEach((m, i) => {
    for (let j = 1; j <= 2; j++) {
      const n = i * 2 + j;
      lessons.push({
        id: DEMO_IDS.lesson(n), module_id: DEMO_IDS.module(i + 1), title: `Sample lesson ${i + 1}.${j}: ${m.title}`, slug: `sample-lesson-${n}`,
        summary: "Placeholder lesson for the demo. Real lessons are added in the course admin.", body: "## Sample lesson\n\nThis is placeholder text so the lesson page can be previewed.\n\n- Point one\n- Point two",
        video_provider: "youtube", video_ref: "demo0000000", duration_seconds: 420 + n * 30, position: j, is_published: true, is_preview: n === 1,
      });
    }
  });
  insert("course_lessons", lessons);
  insert("lesson_progress", [1, 2, 3].map((n) => ({ user_id: user, lesson_id: DEMO_IDS.lesson(n), last_position_seconds: n === 3 ? 120 : 400, completed_at: n === 3 ? null : ago(5 - n), updated_at: ago(5 - n) })));
}
