import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getEbayClient } from "@/lib/ebay/client";
import { bulkUpdatePriceQuantity, type PriceQtyUpdate } from "@/lib/ebay/api";
import { getAdapter, type StockCheck } from "@/lib/suppliers";
import { guardPrice } from "@/lib/margin";
import { logActivity } from "@/lib/activity";
import { decideListing, type MonitorDecision } from "./monitor";
import { chunk, ebayErrorMessage, guardRules, loadAutomationState, loadStoreRules, monitorRules, storeOrgId } from "./store";

/**
 * Runs the price and stock monitor for one store (called from src/jobs/monitor.ts)
 * and applies approved proposals (called from /app/monitor actions).
 */

type MonitoredListing = {
  id: string;
  org_id: string;
  store_id: string;
  sku: string;
  ebay_offer_id: string;
  price: string | number;
  quantity: number;
  status: "active" | "out_of_stock";
  restock_quantity: number | null;
  supplier_product_id: string;
  supplier_products: {
    id: string;
    supplier_id: string;
    external_id: string;
    cost: string | number | null;
    shipping_cost: string | number;
    stock: number | null;
  };
};

const LISTING_COLUMNS =
  "id, org_id, store_id, sku, ebay_offer_id, price, quantity, status, restock_quantity, supplier_product_id, supplier_products!inner(id, supplier_id, external_id, cost, shipping_cost, stock)";

/** Stores whose monitor interval has elapsed. */
export async function dueMonitorStores(now = new Date()): Promise<string[]> {
  const db = createAdminClient();
  const [{ data: stores }, { data: rules }, { data: state }] = await Promise.all([
    db.from("ebay_stores").select("id, org_id, organizations!inner(plan)").eq("status", "active").neq("organizations.plan", "none"),
    db.from("store_rules").select("store_id, monitor_interval_hours"),
    db.from("store_automation").select("store_id, monitor_last_checked_at"),
  ]);
  const interval = new Map((rules ?? []).map((r) => [r.store_id as string, Number(r.monitor_interval_hours) || 12]));
  const last = new Map((state ?? []).map((s) => [s.store_id as string, s.monitor_last_checked_at as string | null]));
  return (stores ?? [])
    .filter((s) => {
      const lastAt = last.get(s.id as string);
      if (!lastAt) return true;
      const hours = interval.get(s.id as string) ?? 12;
      return now.getTime() - Date.parse(lastAt) >= hours * 3_600_000 - 5 * 60_000; // 5 min slack for cron jitter
    })
    .map((s) => s.id as string);
}

async function loadMonitoredListings(storeId: string, supplierId?: string): Promise<MonitoredListing[]> {
  const db = createAdminClient();
  const out: MonitoredListing[] = [];
  for (let from = 0; ; from += 1000) {
    let q = db
      .from("listings")
      .select(LISTING_COLUMNS)
      .eq("store_id", storeId)
      .in("status", ["active", "out_of_stock"])
      .not("ebay_offer_id", "is", null)
      .not("supplier_product_id", "is", null);
    if (supplierId) q = q.eq("supplier_products.supplier_id", supplierId);
    const { data, error } = await q.order("id").range(from, from + 999);
    if (error) throw new Error(`Loading listings failed: ${error.message}`);
    out.push(...((data ?? []) as unknown as MonitoredListing[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

/** Supplier ids with monitored listings in this store. Marks the store as checked. */
export async function startMonitorRun(storeId: string): Promise<{ orgId: string; supplierIds: string[] } | null> {
  const orgId = await storeOrgId(storeId);
  if (!orgId) return null;
  await loadAutomationState(storeId, orgId);
  const db = createAdminClient();
  await db
    .from("store_automation")
    .update({ monitor_last_checked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("store_id", storeId);
  const listings = await loadMonitoredListings(storeId);
  return { orgId, supplierIds: [...new Set(listings.map((l) => l.supplier_products.supplier_id))] };
}

export type MonitorGroupSummary = {
  checked: number;
  outOfStock: number;
  restored: number;
  repriced: number;
  proposals: number;
  failed: number;
  error?: string;
};

/** Checks one supplier's products for a store and applies the decisions. */
export async function runMonitorGroup(storeId: string, supplierId: string): Promise<MonitorGroupSummary> {
  const summary: MonitorGroupSummary = { checked: 0, outOfStock: 0, restored: 0, repriced: 0, proposals: 0, failed: 0 };
  const db = createAdminClient();
  const { data: supplier } = await db.from("suppliers").select("id, adapter, config").eq("id", supplierId).maybeSingle();
  if (!supplier) return { ...summary, error: "Supplier not found" };

  const listings = await loadMonitoredListings(storeId, supplierId);
  if (!listings.length) return summary;

  // 1. Ask the supplier for current cost and stock.
  let checks: StockCheck[];
  try {
    const adapter = getAdapter(supplier.adapter as string);
    const ids = [...new Set(listings.map((l) => l.supplier_products.external_id))];
    checks = (await Promise.all(chunk(ids, 100).map((c) => adapter.checkProducts(c, supplier.config ?? {})))).flat();
  } catch (e) {
    return { ...summary, error: e instanceof Error ? e.message : "Supplier check failed" };
  }
  const byExternal = new Map(checks.map((c) => [c.externalId, c]));

  const rulesRow = await loadStoreRules(storeId);
  const rules = monitorRules(rulesRow);

  // 2. Decide per listing.
  type Plan = { listing: MonitoredListing; decisions: MonitorDecision[]; update: PriceQtyUpdate | null; cost: number; shipping: number };
  const plans: Plan[] = [];
  for (const l of listings) {
    const sp = l.supplier_products;
    const check = byExternal.get(sp.external_id) ?? null;
    summary.checked++;
    const decisions = decideListing(
      {
        price: Number(l.price),
        quantity: l.quantity,
        status: l.status,
        restockQuantity: l.restock_quantity,
        oldCost: sp.cost === null ? null : Number(sp.cost),
        oldShipping: Number(sp.shipping_cost) || 0,
      },
      check,
      rules,
    );
    const cost = check?.cost ?? Number(sp.cost ?? 0);
    const shipping = check?.shippingCost ?? Number(sp.shipping_cost ?? 0);
    const update: PriceQtyUpdate = { sku: l.sku, offerId: l.ebay_offer_id };
    for (const d of decisions) {
      if (d.type === "set_out_of_stock") update.quantity = 0;
      if (d.type === "restore_stock") update.quantity = d.quantity;
      if (d.type === "reprice" && d.mode === "apply") {
        // Belt and braces: never push a price below the floor.
        if (guardPrice(d.newPrice, { supplierCost: cost, supplierShipping: shipping }, rules).ok) update.price = d.newPrice;
        else d.mode = "propose";
      }
    }
    const hasUpdate = update.quantity !== undefined || update.price !== undefined;
    if (decisions.length) plans.push({ listing: l, decisions, update: hasUpdate ? update : null, cost, shipping });
  }

  // 3. Push quantity/price changes to eBay (25 per call).
  const failedSkus = new Map<string, string>();
  const updates = plans.flatMap((p) => (p.update ? [p.update] : []));
  if (updates.length) {
    const client = await getEbayClient(storeId);
    for (const batch of chunk(updates, 25)) {
      try {
        const res = await bulkUpdatePriceQuantity(client, batch);
        for (const r of res?.responses ?? []) {
          if (r.statusCode >= 300) failedSkus.set(r.sku, JSON.stringify(r.errors ?? []).slice(0, 500));
        }
      } catch (e) {
        for (const u of batch) failedSkus.set(u.sku, ebayErrorMessage(e));
      }
    }
  }

  // 4. Record results, log, create proposals.
  const now = new Date().toISOString();
  for (const p of plans) {
    const l = p.listing;
    const failed = p.update ? failedSkus.get(l.sku) : undefined;
    if (failed) {
      summary.failed++;
      await db.from("listings").update({ last_error: `Monitor update failed: ${failed}`, updated_at: now }).eq("id", l.id);
    }
    const cost = { supplierCost: p.cost, supplierShipping: p.shipping };
    for (const d of p.decisions) {
      const base = { orgId: l.org_id, storeId, actor: "automation" as const, entityType: "listing" as const, entityId: l.id };
      if (d.type === "set_out_of_stock" && !failed) {
        await db
          .from("listings")
          .update({ quantity: 0, status: "out_of_stock", restock_quantity: d.restockQuantity, updated_at: now })
          .eq("id", l.id);
        await logActivity({
          ...base,
          action: "quantity_set",
          before: { quantity: l.quantity, status: l.status, sku: l.sku },
          after: { quantity: 0, status: "out_of_stock", reason: d.reason },
          undoable: true,
        });
        summary.outOfStock++;
      } else if (d.type === "restore_stock" && !failed) {
        await db
          .from("listings")
          .update({ quantity: d.quantity, status: "active", restock_quantity: null, updated_at: now })
          .eq("id", l.id);
        await logActivity({
          ...base,
          action: "quantity_set",
          before: { quantity: l.quantity, status: l.status, sku: l.sku },
          after: { quantity: d.quantity, status: "active", reason: d.reason },
          undoable: true,
        });
        summary.restored++;
      } else if (d.type === "reprice" && d.mode === "apply" && !failed) {
        const margin = guardPrice(d.newPrice, cost, rules).breakdown.marginPct;
        await db.from("listings").update({ price: d.newPrice, net_margin_pct: margin, updated_at: now }).eq("id", l.id);
        await logActivity({
          ...base,
          action: "price_changed",
          before: { price: Number(l.price), sku: l.sku },
          after: { price: d.newPrice, marginPct: margin, reason: d.reason },
          undoable: true,
        });
        summary.repriced++;
      } else if ((d.type === "reprice" && d.mode === "propose") || d.type === "flag") {
        await db
          .from("monitor_proposals")
          .update({ status: "dismissed", decided_at: now, reason: "Superseded by a newer check." })
          .eq("listing_id", l.id)
          .eq("status", "pending");
        const { error } = await db.from("monitor_proposals").insert({
          org_id: l.org_id,
          listing_id: l.id,
          action: d.type === "reprice" ? "reprice" : "flag",
          old_cost: l.supplier_products.cost === null ? null : Number(l.supplier_products.cost),
          new_cost: p.cost,
          old_stock: l.supplier_products.stock,
          new_stock: byExternal.get(l.supplier_products.external_id)?.stock ?? null,
          old_price: Number(l.price),
          proposed_price: d.type === "reprice" ? d.newPrice : d.proposedPrice,
          margin_before_pct: d.marginBefore,
          margin_after_pct: d.marginAfter,
          reason: d.reason,
        });
        if (!error) summary.proposals++;
      }
    }
  }

  // 5. Store the supplier's latest cost and stock (after deciding, so a retry still sees the change).
  for (const l of listings) {
    const sp = l.supplier_products;
    const check = byExternal.get(sp.external_id);
    await db
      .from("supplier_products")
      .update(
        check
          ? { cost: check.cost, shipping_cost: check.shippingCost, stock: check.available ? check.stock : 0, last_checked_at: now }
          : { stock: 0, last_checked_at: now },
      )
      .eq("id", sp.id);
  }

  return summary;
}

/* ---------------- Proposals (seller approval) ---------------- */

export type ProposalResult = { ok: boolean; message: string };

/** Applies one pending proposal on eBay after re-checking the margin floor. */
export async function applyProposal(proposalId: string, ctx: { orgId: string; userId: string }): Promise<ProposalResult> {
  const db = createAdminClient();
  const { data: p } = await db
    .from("monitor_proposals")
    .select(
      "id, org_id, status, proposed_price, listing_id, listings!inner(id, store_id, sku, ebay_offer_id, price, quantity, status, restock_quantity, title, supplier_products(cost, shipping_cost, stock))",
    )
    .eq("id", proposalId)
    .eq("org_id", ctx.orgId)
    .maybeSingle();
  if (!p) return { ok: false, message: "Proposal not found." };
  if (p.status !== "pending") return { ok: false, message: "This proposal was already decided." };

  const l = p.listings as unknown as {
    id: string;
    store_id: string;
    sku: string;
    ebay_offer_id: string | null;
    price: string | number;
    quantity: number;
    status: string;
    restock_quantity: number | null;
    title: string;
    supplier_products: { cost: string | number | null; shipping_cost: string | number; stock: number | null } | null;
  };
  const price = p.proposed_price === null ? null : Number(p.proposed_price);
  if (price === null) return { ok: false, message: `"${l.title}": there's no price to apply. Edit the listing instead, or dismiss.` };
  if (!l.ebay_offer_id) return { ok: false, message: `"${l.title}" isn't live on eBay.` };
  if (l.supplier_products?.cost === null || l.supplier_products?.cost === undefined) {
    return { ok: false, message: `"${l.title}" has no supplier cost, so the margin can't be checked.` };
  }

  const rules = guardRules(await loadStoreRules(l.store_id));
  const cost = { supplierCost: Number(l.supplier_products.cost), supplierShipping: Number(l.supplier_products.shipping_cost) || 0 };
  const guard = guardPrice(price, cost, rules);
  if (!guard.ok) return { ok: false, message: `"${l.title}": ${guard.reasons.join(" ")} Not applied.` };

  const stock = l.supplier_products.stock ?? 0;
  const restore = l.status === "out_of_stock" && stock > 0;
  const update: PriceQtyUpdate = { sku: l.sku, offerId: l.ebay_offer_id, price };
  if (restore) update.quantity = Math.max(1, Math.min(stock, l.restock_quantity ?? 1));

  try {
    const client = await getEbayClient(l.store_id);
    const res = await bulkUpdatePriceQuantity(client, [update]);
    const r = res?.responses?.[0];
    if (r && r.statusCode >= 300) throw new Error(`eBay rejected the update: ${JSON.stringify(r.errors ?? []).slice(0, 300)}`);
  } catch (e) {
    await db.from("monitor_proposals").update({ status: "failed", decided_by: ctx.userId, decided_at: new Date().toISOString() }).eq("id", p.id);
    return { ok: false, message: `"${l.title}": ${ebayErrorMessage(e)}` };
  }

  const now = new Date().toISOString();
  await db
    .from("listings")
    .update({
      price,
      net_margin_pct: guard.breakdown.marginPct,
      ...(restore ? { quantity: update.quantity, status: "active", restock_quantity: null } : {}),
      updated_at: now,
    })
    .eq("id", l.id);
  await db.from("monitor_proposals").update({ status: "applied", decided_by: ctx.userId, decided_at: now }).eq("id", p.id);
  const base = { orgId: ctx.orgId, storeId: l.store_id, actor: "user" as const, userId: ctx.userId, entityType: "listing" as const, entityId: l.id };
  await logActivity({
    ...base,
    action: "price_changed",
    before: { price: Number(l.price), sku: l.sku },
    after: { price, marginPct: guard.breakdown.marginPct, proposalId: p.id },
    undoable: true,
  });
  if (restore) {
    await logActivity({
      ...base,
      action: "quantity_set",
      before: { quantity: l.quantity, status: l.status, sku: l.sku },
      after: { quantity: update.quantity, status: "active", reason: "Restocked with the approved price." },
      undoable: true,
    });
  }
  return { ok: true, message: `"${l.title}" is now $${price.toFixed(2)}.` };
}
