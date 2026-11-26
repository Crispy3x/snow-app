import { guardPrice, type GuardRules } from "@/lib/margin";
import { safePriceForMargin } from "./pricing";

/**
 * Price and stock monitor: what to do with one listing after a supplier check.
 * Pure function, no I/O. The job in src/lib/automation/monitor-run.ts applies it.
 *
 * eBay terms (docs/PLAN.md §4): supplier price changes produce a proposal the seller
 * approves unless the store turned approval off. Out-of-stock is applied
 * automatically (it only protects the seller) and is undoable.
 */

/** Reprice down only when the margin is more than this many points above the floor. */
export const MARGIN_BUFFER_PCT = 15;
/** New prices aim this many points above the floor, so small cost moves don't trigger again. */
export const REPRICE_TARGET_OVER_FLOOR_PCT = 5;
/** Quantity restored when we don't know what it was before. */
export const DEFAULT_RESTOCK_QUANTITY = 1;

export type MonitorRules = GuardRules & {
  monitorAction: "reprice" | "out_of_stock" | "flag";
  repriceRequiresApproval: boolean;
  bufferPct?: number;
  targetOverFloorPct?: number;
};

export type MonitorListing = {
  price: number;
  quantity: number;
  status: "active" | "out_of_stock";
  /** Quantity before the monitor set it to 0 (listings.restock_quantity). */
  restockQuantity: number | null;
  /** Supplier cost and shipping as last stored, before this check. */
  oldCost: number | null;
  oldShipping: number;
};

/** null = the supplier no longer returns the product. */
export type SupplierState = { available: boolean; stock: number; cost: number; shippingCost: number } | null;

export type MonitorDecision =
  | { type: "set_out_of_stock"; quantity: 0; restockQuantity: number; reason: string }
  | { type: "restore_stock"; quantity: number; reason: string }
  | { type: "reprice"; mode: "apply" | "propose"; newPrice: number; marginBefore: number; marginAfter: number; reason: string }
  | { type: "flag"; proposedPrice: number | null; marginBefore: number; marginAfter: number | null; reason: string };

const usd = (n: number) => `$${n.toFixed(2)}`;
const changed = (a: number, b: number) => Math.abs(a - b) >= 0.005;

export function decideListing(listing: MonitorListing, supplier: SupplierState, rules: MonitorRules): MonitorDecision[] {
  const buffer = rules.bufferPct ?? MARGIN_BUFFER_PCT;
  const targetOver = rules.targetOverFloorPct ?? REPRICE_TARGET_OVER_FLOOR_PCT;
  const floor = rules.minNetMarginPct;

  // 1. Supplier can't fill orders: stop selling now.
  if (!supplier || !supplier.available || supplier.stock <= 0) {
    if (listing.status === "active" && listing.quantity > 0) {
      return [
        {
          type: "set_out_of_stock",
          quantity: 0,
          restockQuantity: listing.quantity,
          reason: !supplier ? "The supplier no longer lists this product." : "The supplier is out of stock.",
        },
      ];
    }
    return [];
  }

  const decisions: MonitorDecision[] = [];
  const wantsRestore = listing.status === "out_of_stock";
  let blockRestore = false;

  // 2. Cost moved: check the margin at the current price.
  const costMoved =
    listing.oldCost !== null && (changed(supplier.cost, listing.oldCost) || changed(supplier.shippingCost, listing.oldShipping));
  if (costMoved) {
    const cost = { supplierCost: supplier.cost, supplierShipping: supplier.shippingCost };
    const guard = guardPrice(listing.price, cost, rules);
    const marginBefore = guard.breakdown.marginPct;
    const below = !guard.ok;
    const above = !below && marginBefore > floor + buffer;

    if (below || above) {
      const candidate = safePriceForMargin(floor + targetOver, cost, rules);
      const newPrice = candidate !== null && (below ? candidate > listing.price : candidate < listing.price) ? candidate : null;
      const marginAfter = newPrice !== null ? guardPrice(newPrice, cost, rules).breakdown.marginPct : null;
      const costText = `Supplier cost went from ${usd(listing.oldCost!)} to ${usd(supplier.cost)}`;
      const reason = below
        ? `${costText}; the margin at the current price is ${marginBefore}%, below the ${floor}% floor.`
        : `${costText}; the margin is ${marginBefore}%, more than ${buffer} points above the ${floor}% floor.`;

      if (rules.monitorAction === "reprice" && newPrice !== null && marginAfter !== null) {
        const mode = rules.repriceRequiresApproval ? "propose" : "apply";
        decisions.push({ type: "reprice", mode, newPrice, marginBefore, marginAfter, reason });
        // A below-floor listing stays out of stock until the new price is live.
        if (below && mode === "propose") blockRestore = true;
      } else if (rules.monitorAction === "out_of_stock" && below) {
        blockRestore = true;
        if (listing.status === "active" && listing.quantity > 0) {
          decisions.push({ type: "set_out_of_stock", quantity: 0, restockQuantity: listing.quantity, reason });
        }
      } else if (below || rules.monitorAction !== "reprice" || newPrice !== null) {
        // 'flag', 'out_of_stock' with a margin above the buffer, or 'reprice' when no valid price exists.
        const noPrice = newPrice === null && below ? " No price reaches the floor at this cost." : "";
        decisions.push({ type: "flag", proposedPrice: newPrice, marginBefore, marginAfter, reason: reason + noPrice });
        if (below) blockRestore = true;
      }
    }
  }

  // 3. Stock is back.
  if (wantsRestore && !blockRestore) {
    const quantity = Math.max(1, Math.min(supplier.stock, listing.restockQuantity ?? DEFAULT_RESTOCK_QUANTITY));
    decisions.push({ type: "restore_stock", quantity, reason: `The supplier has ${supplier.stock} in stock again.` });
  }

  return decisions;
}
