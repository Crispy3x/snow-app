import type { InventoryItem, PriceQtyUpdate } from "@/lib/ebay/api";

/**
 * Undo for activity_log entries. The reversers depend only on the small
 * interfaces below, so they're unit tested with a mock eBay client; the
 * server wiring (database, real eBay client, logging) is in undo-server.ts.
 */

export type ActivityRow = {
  id: number;
  org_id: string;
  store_id: string | null;
  actor: string;
  entity_type: string;
  entity_id: string | null;
  action: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  undoable: boolean;
  undone_at: string | null;
  undo_of: number | null;
};

export type UndoListing = {
  id: string;
  sku: string;
  ebay_offer_id: string | null;
  ebay_listing_id: string | null;
  price: number;
  quantity: number;
  status: string;
};

export interface UndoEbay {
  updatePriceQuantity(update: PriceQtyUpdate): Promise<void>;
  publishOffer(offerId: string): Promise<{ listingId: string }>;
  withdrawOffer(offerId: string): Promise<void>;
  getInventoryItem(sku: string): Promise<InventoryItem>;
  putInventoryItem(sku: string, item: InventoryItem): Promise<void>;
  updateAdBid(campaignId: string, ebayListingId: string, bidPct: number): Promise<void>;
}

export interface UndoDeps {
  ebay: UndoEbay;
  loadListing(id: string): Promise<UndoListing | null>;
  updateListing(id: string, patch: Record<string, unknown>): Promise<void>;
  /** Margin guard at a price; undo doesn't require it to pass, but warns. */
  checkFloor(listingId: string, price: number): Promise<{ ok: boolean; reasons: string[] }>;
}

export type UndoResult =
  | { ok: true; before: Record<string, unknown>; after: Record<string, unknown>; warning?: string }
  | { ok: false; message: string };

export const REVERSIBLE_ACTIONS = ["price_changed", "quantity_set", "listing_ended", "title_changed", "ad_bid_changed", "listing_published", "listing_edited"] as const;

const NOT_UNDOABLE_REASONS: Record<string, string> = {
  offer_sent: "eBay doesn't allow cancelling an offer that was already sent to buyers.",
  tracking_posted: "Tracking was already sent to eBay and the buyer; correct it in Seller Hub if needed.",
  sale_created: "Sale events can't be undone here. End or edit the sale in Seller Hub.",
  ad_created: "Removing an ad isn't automated yet. Remove it from the campaign in Seller Hub.",
  campaign_created: "Campaigns can't be removed here. End the campaign in Seller Hub.",
  pii_purged: "Purged buyer data is deleted permanently.",
};

/** Why an entry can't be undone, or null when it can. */
export function undoBlockReason(e: Pick<ActivityRow, "action" | "undoable" | "undone_at" | "undo_of">): string | null {
  if (e.undo_of !== null) return "This entry is itself an undo.";
  if (e.undone_at) return `Already undone on ${new Date(e.undone_at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}.`;
  if (!e.undoable) return NOT_UNDOABLE_REASONS[e.action] ?? "This change can't be reversed through the eBay API.";
  if (!(REVERSIBLE_ACTIONS as readonly string[]).includes(e.action)) return "There's no undo for this kind of change yet.";
  return null;
}

const num = (v: unknown): number | null => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

async function listingFor(e: ActivityRow, deps: UndoDeps): Promise<UndoListing | null> {
  return e.entity_type === "listing" && e.entity_id ? deps.loadListing(e.entity_id) : null;
}

/** Runs the reverser for one entry. Caller is responsible for authorisation and logging. */
export async function reverseEntry(e: ActivityRow, deps: UndoDeps): Promise<UndoResult> {
  const blocked = undoBlockReason(e);
  if (blocked) return { ok: false, message: blocked };
  const before = e.before ?? {};

  switch (e.action) {
    case "price_changed": {
      const price = num(before.price);
      const l = await listingFor(e, deps);
      if (price === null || price <= 0) return { ok: false, message: "The old price wasn't recorded." };
      if (!l?.ebay_offer_id) return { ok: false, message: "The listing has no eBay offer to update." };
      const guard = await deps.checkFloor(l.id, price);
      await deps.ebay.updatePriceQuantity({ sku: l.sku, offerId: l.ebay_offer_id, price });
      await deps.updateListing(l.id, { price });
      return {
        ok: true,
        before: { price: l.price },
        after: { price },
        ...(guard.ok ? {} : { warning: `Restored, but the old price is below the margin floor: ${guard.reasons.join(" ")}` }),
      };
    }

    case "quantity_set": {
      const quantity = num(before.quantity);
      const l = await listingFor(e, deps);
      if (quantity === null || quantity < 0) return { ok: false, message: "The old quantity wasn't recorded." };
      if (!l?.ebay_offer_id) return { ok: false, message: "The listing has no eBay offer to update." };
      const status = typeof before.status === "string" ? before.status : quantity > 0 ? "active" : "out_of_stock";
      await deps.ebay.updatePriceQuantity({ sku: l.sku, offerId: l.ebay_offer_id, quantity });
      await deps.updateListing(l.id, { quantity, status, restock_quantity: null });
      return { ok: true, before: { quantity: l.quantity, status: l.status }, after: { quantity, status } };
    }

    case "listing_ended": {
      const l = await listingFor(e, deps);
      const offerId = (typeof before.offerId === "string" && before.offerId) || l?.ebay_offer_id;
      if (!l || !offerId) return { ok: false, message: "The listing's eBay offer wasn't found." };
      const { listingId } = await deps.ebay.publishOffer(offerId);
      await deps.updateListing(l.id, { status: "active", ebay_listing_id: listingId, ended_at: null });
      return { ok: true, before: { status: l.status }, after: { status: "active", ebayListingId: listingId } };
    }

    case "title_changed": {
      const title = typeof before.title === "string" ? before.title : null;
      const l = await listingFor(e, deps);
      if (!title) return { ok: false, message: "The old title wasn't recorded." };
      if (!l) return { ok: false, message: "The listing wasn't found." };
      const current = await deps.ebay.getInventoryItem(l.sku);
      const item: InventoryItem = {
        availability: current.availability,
        condition: current.condition,
        product: { ...current.product, title },
      };
      await deps.ebay.putInventoryItem(l.sku, item);
      await deps.updateListing(l.id, { title });
      return { ok: true, before: { title: current.product.title }, after: { title } };
    }

    case "listing_published": {
      const l = await listingFor(e, deps);
      const offerId = (typeof e.after?.offer_id === "string" && e.after.offer_id) || l?.ebay_offer_id;
      if (!l || !offerId) return { ok: false, message: "The listing's eBay offer wasn't found." };
      if (l.status !== "active") return { ok: false, message: "The listing isn't live any more." };
      await deps.ebay.withdrawOffer(offerId);
      await deps.updateListing(l.id, { status: "ended", ended_at: new Date().toISOString() });
      return { ok: true, before: { status: l.status }, after: { status: "ended" } };
    }

    case "listing_edited": {
      const l = await listingFor(e, deps);
      if (!l) return { ok: false, message: "The listing wasn't found." };
      const price = num(before.price);
      const quantity = num(before.quantity);
      const title = typeof before.title === "string" ? before.title : null;
      const live = !!l.ebay_offer_id && (l.status === "active" || l.status === "out_of_stock");
      const warnings: string[] = [];
      if (live && (price !== null || quantity !== null)) {
        if (price !== null) {
          const guard = await deps.checkFloor(l.id, price);
          if (!guard.ok) warnings.push(`The old price is below the margin floor: ${guard.reasons.join(" ")}`);
        }
        await deps.ebay.updatePriceQuantity({
          sku: l.sku,
          offerId: l.ebay_offer_id!,
          ...(price !== null ? { price } : {}),
          ...(quantity !== null ? { quantity } : {}),
        });
      }
      if (live && title) {
        const current = await deps.ebay.getInventoryItem(l.sku);
        await deps.ebay.putInventoryItem(l.sku, { ...current, product: { ...current.product, title } });
      }
      const patch: Record<string, unknown> = {};
      if (price !== null) patch.price = price;
      if (quantity !== null) patch.quantity = quantity;
      if (title) patch.title = title;
      if (!Object.keys(patch).length) return { ok: false, message: "Nothing to restore was recorded." };
      await deps.updateListing(l.id, patch);
      return {
        ok: true,
        before: { ...(e.after ?? {}) },
        after: patch,
        ...(warnings.length ? { warning: `Restored, but ${warnings.join(" ")}` } : {}),
      };
    }

    case "ad_bid_changed": {
      const bidPct = num(before.bidPct);
      const campaignId = typeof before.campaignId === "string" ? before.campaignId : null;
      const l = await listingFor(e, deps);
      const ebayListingId = (typeof before.ebayListingId === "string" && before.ebayListingId) || l?.ebay_listing_id;
      if (bidPct === null || !campaignId || !ebayListingId) return { ok: false, message: "The old bid or campaign wasn't recorded." };
      await deps.ebay.updateAdBid(campaignId, ebayListingId, bidPct);
      if (l) await deps.updateListing(l.id, { ad_rate_pct: bidPct });
      return { ok: true, before: { bidPct: num(e.after?.bidPct) }, after: { bidPct } };
    }
  }
  return { ok: false, message: "There's no undo for this kind of change yet." };
}
