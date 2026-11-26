import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { EbayApiError, getEbayClient } from "@/lib/ebay/client";
import {
  bulkCreateAds,
  bulkUpdateAdBids,
  createCostPerSaleCampaign,
  createMarkdownSale,
  findEligibleItems,
  getCampaigns,
  sendOfferToInterestedBuyers,
} from "@/lib/ebay/api";
import { findMarkdownSaleByName, getCampaignAds } from "@/lib/ebay/automation-api";
import { guardPrice } from "@/lib/margin";
import { logActivity } from "@/lib/activity";
import { computeOfferPrice, type OfferQuote } from "./offers";
import { bidForListing, CAMPAIGN_NAME, type BidStrategy } from "./ads";
import { chunk, ebayErrorMessage, guardRules, loadAutomationState, loadStoreRules, updateAutomationState } from "./store";

/** Offers to watchers, sale events and promoted listings for /app/promotions. */

type Ctx = { orgId: string; userId: string; storeId: string };
type Result = { ok: boolean; message: string };

type CostedListing = {
  id: string;
  title: string;
  sku: string;
  price: number;
  ebay_listing_id: string;
  watchers: number;
  cost: number | null;
  shipping: number;
};

async function loadCostedListings(storeId: string, orgId: string, filter: { ebayListingIds?: string[]; ids?: string[] }) {
  const db = createAdminClient();
  let q = db
    .from("listings")
    .select("id, title, sku, price, ebay_listing_id, watchers, sale_promotion_id, supplier_products(cost, shipping_cost)")
    .eq("store_id", storeId)
    .eq("org_id", orgId)
    .eq("status", "active")
    .not("ebay_listing_id", "is", null);
  if (filter.ebayListingIds) q = q.in("ebay_listing_id", filter.ebayListingIds);
  if (filter.ids) q = q.in("id", filter.ids);
  const { data } = await q.limit(1000);
  return (data ?? []).map((l) => {
    const sp = l.supplier_products as unknown as { cost: string | number | null; shipping_cost: string | number } | null;
    return {
      id: l.id as string,
      title: l.title as string,
      sku: l.sku as string,
      price: Number(l.price),
      ebay_listing_id: l.ebay_listing_id as string,
      watchers: Number(l.watchers) || 0,
      sale_promotion_id: l.sale_promotion_id as string | null,
      cost: sp?.cost === null || sp?.cost === undefined ? null : Number(sp.cost),
      shipping: Number(sp?.shipping_cost) || 0,
    };
  });
}

function quote(l: CostedListing, targetMarginPct: number, rules: ReturnType<typeof guardRules>): OfferQuote {
  if (l.cost === null) return { ok: false, reason: "No supplier cost on file.", price: null };
  return computeOfferPrice({ targetMarginPct, currentPrice: l.price, cost: { supplierCost: l.cost, supplierShipping: l.shipping }, rules });
}

/* ---------------- Offers to watchers ---------------- */

export type OfferPreviewRow = CostedListing & { quote: OfferQuote };

export async function previewWatcherOffers(storeId: string, orgId: string, targetMarginPct: number): Promise<OfferPreviewRow[]> {
  const client = await getEbayClient(storeId);
  const ids: string[] = [];
  for (let offset = 0; offset < 2000; offset += 200) {
    const res = await findEligibleItems(client, offset);
    ids.push(...(res.eligibleItems ?? []).map((i) => i.listingId));
    if (!res.eligibleItems || res.eligibleItems.length < 200) break;
  }
  if (!ids.length) return [];
  const rules = guardRules(await loadStoreRules(storeId));
  const listings = (await Promise.all(chunk(ids, 200).map((c) => loadCostedListings(storeId, orgId, { ebayListingIds: c })))).flat();
  return listings.map((l) => ({ ...l, quote: quote(l, targetMarginPct, rules) }));
}

function isOfferLimitError(e: unknown): boolean {
  if (!(e instanceof EbayApiError)) return false;
  const text = `${e.message} ${e.errors.map((x) => `${x.message ?? ""} ${x.longMessage ?? ""}`).join(" ")}`.toLowerCase();
  return e.status === 409 || /limit|already sent|maximum|too many/.test(text);
}

export async function sendWatcherOffers(ctx: Ctx, listingIds: string[], targetMarginPct: number, message: string): Promise<Result> {
  const db = createAdminClient();
  const rules = guardRules(await loadStoreRules(ctx.storeId));
  const listings = await loadCostedListings(ctx.storeId, ctx.orgId, { ids: listingIds });
  if (!listings.length) return { ok: false, message: "None of the selected listings are active." };
  const client = await getEbayClient(ctx.storeId);

  let sent = 0;
  const problems: string[] = [];
  for (const l of listings) {
    const q = quote(l, targetMarginPct, rules);
    if (!q.ok) {
      problems.push(`${l.title}: ${q.reason}`);
      continue;
    }
    const { data: row } = await db
      .from("watcher_offers")
      .insert({ org_id: ctx.orgId, listing_id: l.id, offer_price: q.price, net_margin_pct: q.marginPct, message: message || null, status: "running" })
      .select("id")
      .single();
    try {
      const res = await sendOfferToInterestedBuyers(client, l.ebay_listing_id, q.price, message);
      const offerIds = (res?.offers ?? []).map((o) => o.offerId);
      if (row) await db.from("watcher_offers").update({ status: "done", ebay_offer_ids: offerIds }).eq("id", row.id);
      await logActivity({
        orgId: ctx.orgId,
        storeId: ctx.storeId,
        actor: "user",
        userId: ctx.userId,
        entityType: "offer",
        entityId: l.id,
        action: "offer_sent",
        before: { price: l.price },
        after: { offerPrice: q.price, marginPct: q.marginPct, buyers: offerIds.length, ebayListingId: l.ebay_listing_id },
        undoable: false,
      });
      sent++;
    } catch (e) {
      const msg = isOfferLimitError(e)
        ? "eBay won't send another offer for this listing yet (offer limit reached). Try again in a few days."
        : ebayErrorMessage(e);
      if (row) await db.from("watcher_offers").update({ status: "failed", error: msg }).eq("id", row.id);
      problems.push(`${l.title}: ${msg}`);
    }
  }
  const head = sent ? `Sent offers on ${sent} listing${sent === 1 ? "" : "s"}.` : "No offers were sent.";
  return { ok: sent > 0, message: problems.length ? `${head} Skipped: ${problems.slice(0, 5).join(" | ")}${problems.length > 5 ? ` and ${problems.length - 5} more` : ""}` : head };
}

/* ---------------- Sale events ---------------- */

export async function createSaleEvent(
  ctx: Ctx,
  input: { listingIds: string[]; discountPct: number; startDate: Date; endDate: Date; name: string },
): Promise<Result> {
  const db = createAdminClient();
  const rules = guardRules(await loadStoreRules(ctx.storeId));
  const listings = (await loadCostedListings(ctx.storeId, ctx.orgId, { ids: input.listingIds })).filter((l) => !l.sale_promotion_id);
  if (!listings.length) return { ok: false, message: "None of the selected listings can join a sale (they must be active and not in another sale)." };

  const passing: typeof listings = [];
  const skipped: string[] = [];
  for (const l of listings) {
    if (l.cost === null) {
      skipped.push(`${l.title}: no supplier cost`);
      continue;
    }
    const g = guardPrice(l.price, { supplierCost: l.cost, supplierShipping: l.shipping }, { ...rules, saleDiscountPct: input.discountPct });
    if (g.ok) passing.push(l);
    else skipped.push(`${l.title}: ${g.breakdown.marginPct}% margin at ${input.discountPct}% off`);
  }
  if (!passing.length) return { ok: false, message: `No listing keeps its margin floor at ${input.discountPct}% off. ${skipped.slice(0, 3).join(" | ")}` };

  const name = input.name.slice(0, 90);
  let ebayId: string | null = null;
  try {
    const client = await getEbayClient(ctx.storeId);
    await createMarkdownSale(client, {
      name,
      percentOff: input.discountPct,
      listingIds: passing.map((l) => l.ebay_listing_id),
      startDate: input.startDate.toISOString(),
      endDate: input.endDate.toISOString(),
    });
    ebayId = (await findMarkdownSaleByName(client, name).catch(() => null))?.promotionId ?? null;
  } catch (e) {
    return { ok: false, message: ebayErrorMessage(e) };
  }

  const { data: promo } = await db
    .from("promotions")
    .insert({
      org_id: ctx.orgId,
      store_id: ctx.storeId,
      kind: "sale_event",
      ebay_id: ebayId,
      name,
      config: { percentOff: input.discountPct, listingIds: passing.map((l) => l.id), skipped },
      starts_at: input.startDate.toISOString(),
      ends_at: input.endDate.toISOString(),
      status: "scheduled",
    })
    .select("id")
    .single();
  const saleRef = ebayId ?? (promo ? `mp:${promo.id}` : "unknown");
  await db.from("listings").update({ sale_promotion_id: saleRef }).in("id", passing.map((l) => l.id));
  await logActivity({
    orgId: ctx.orgId,
    storeId: ctx.storeId,
    actor: "user",
    userId: ctx.userId,
    entityType: "promotion",
    entityId: promo?.id ?? null,
    action: "sale_created",
    before: null,
    after: { name, percentOff: input.discountPct, listings: passing.length, ebayPromotionId: ebayId },
    undoable: false,
  });
  const head = `Sale "${name}" scheduled for ${passing.length} listing${passing.length === 1 ? "" : "s"}.`;
  return { ok: true, message: skipped.length ? `${head} Left out (margin floor): ${skipped.slice(0, 5).join(" | ")}` : head };
}

/* ---------------- Promoted listings ---------------- */

export async function setBidStrategy(storeId: string, orgId: string, strategy: BidStrategy): Promise<void> {
  await updateAutomationState(storeId, orgId, { ad_bid_strategy: strategy });
}

async function ensureCampaign(storeId: string, orgId: string): Promise<{ campaignId: string; created: boolean }> {
  const state = await loadAutomationState(storeId, orgId);
  const client = await getEbayClient(storeId);
  const find = async () =>
    (await getCampaigns(client)).campaigns?.find((c) => c.campaignName === CAMPAIGN_NAME && c.campaignStatus !== "ENDED")?.campaignId ?? null;
  let campaignId = state.ad_campaign_id;
  if (campaignId) {
    const live = await find();
    if (live !== campaignId) campaignId = live;
  } else {
    campaignId = await find();
  }
  let created = false;
  if (!campaignId) {
    const rules = await loadStoreRules(storeId);
    const tiers = rules.ad_rate_tiers ?? [];
    const defaultBid = tiers.length ? Math.max(2, Math.min(...tiers.map((t) => t.min_rate))) : 2;
    await createCostPerSaleCampaign(client, CAMPAIGN_NAME, defaultBid);
    campaignId = await find();
    if (!campaignId) throw new Error("The campaign was created but eBay didn't return it yet. Try again in a minute.");
    created = true;
  }
  if (campaignId !== state.ad_campaign_id) await updateAutomationState(storeId, orgId, { ad_campaign_id: campaignId });
  return { campaignId, created };
}

export async function applyTierBids(ctx: Ctx): Promise<Result> {
  const db = createAdminClient();
  const rulesRow = await loadStoreRules(ctx.storeId);
  const tiers = rulesRow.ad_rate_tiers ?? [];
  if (!tiers.length) return { ok: false, message: "Set ad-rate tiers in store rules first." };
  const state = await loadAutomationState(ctx.storeId, ctx.orgId);

  let campaignId: string;
  let created: boolean;
  try {
    ({ campaignId, created } = await ensureCampaign(ctx.storeId, ctx.orgId));
  } catch (e) {
    return { ok: false, message: ebayErrorMessage(e) };
  }
  if (created) {
    await db.from("promotions").insert({
      org_id: ctx.orgId,
      store_id: ctx.storeId,
      kind: "promoted_listings",
      ebay_id: campaignId,
      name: CAMPAIGN_NAME,
      config: { fundingModel: "COST_PER_SALE", strategy: state.ad_bid_strategy },
      starts_at: new Date().toISOString(),
      status: "running",
    });
    await logActivity({
      orgId: ctx.orgId,
      storeId: ctx.storeId,
      actor: "user",
      userId: ctx.userId,
      entityType: "promotion",
      entityId: campaignId,
      action: "campaign_created",
      after: { campaignId, name: CAMPAIGN_NAME, model: "COST_PER_SALE" },
      undoable: false,
    });
  }

  const { data: rows } = await db
    .from("listings")
    .select("id, title, price, ebay_listing_id, ad_rate_pct")
    .eq("store_id", ctx.storeId)
    .eq("org_id", ctx.orgId)
    .eq("status", "active")
    .not("ebay_listing_id", "is", null)
    .limit(5000);
  const listings = rows ?? [];
  const client = await getEbayClient(ctx.storeId);

  let existing: Map<string, number>;
  try {
    existing = new Map((await getCampaignAds(client, campaignId)).map((a) => [a.listingId, Number(a.bidPercentage ?? 0)]));
  } catch (e) {
    return { ok: false, message: ebayErrorMessage(e) };
  }

  const toCreate: { id: string; listingId: string; bidPct: number }[] = [];
  const toUpdate: { id: string; listingId: string; bidPct: number; old: number }[] = [];
  for (const l of listings) {
    const bid = bidForListing(tiers, Number(l.price), state.ad_bid_strategy);
    if (bid === null) continue;
    const ebayListingId = l.ebay_listing_id as string;
    const current = existing.get(ebayListingId);
    if (current === undefined) toCreate.push({ id: l.id as string, listingId: ebayListingId, bidPct: bid });
    else if (Math.abs(current - bid) >= 0.05) toUpdate.push({ id: l.id as string, listingId: ebayListingId, bidPct: bid, old: current });
  }

  let createdAds = 0;
  let updatedAds = 0;
  const errors: string[] = [];
  for (const batch of chunk(toCreate, 500)) {
    try {
      const res = await bulkCreateAds(client, campaignId, batch);
      const failed = new Set((res?.responses ?? []).filter((r) => r.statusCode >= 300).map((r) => r.listingId));
      for (const a of batch) {
        if (failed.has(a.listingId)) continue;
        createdAds++;
        await db.from("listings").update({ ad_rate_pct: a.bidPct }).eq("id", a.id);
        await logActivity({
          orgId: ctx.orgId,
          storeId: ctx.storeId,
          actor: "user",
          userId: ctx.userId,
          entityType: "listing",
          entityId: a.id,
          action: "ad_created",
          after: { bidPct: a.bidPct, campaignId, ebayListingId: a.listingId },
          undoable: false,
        });
      }
      if (failed.size) errors.push(`${failed.size} ads couldn't be created`);
    } catch (e) {
      errors.push(ebayErrorMessage(e));
    }
  }
  for (const batch of chunk(toUpdate, 500)) {
    try {
      await bulkUpdateAdBids(client, campaignId, batch);
      for (const a of batch) {
        updatedAds++;
        await db.from("listings").update({ ad_rate_pct: a.bidPct }).eq("id", a.id);
        await logActivity({
          orgId: ctx.orgId,
          storeId: ctx.storeId,
          actor: "user",
          userId: ctx.userId,
          entityType: "listing",
          entityId: a.id,
          action: "ad_bid_changed",
          before: { bidPct: a.old, campaignId, ebayListingId: a.listingId },
          after: { bidPct: a.bidPct },
          undoable: true,
        });
      }
    } catch (e) {
      errors.push(ebayErrorMessage(e));
    }
  }

  const head = `Campaign "${CAMPAIGN_NAME}": ${createdAds} ads added, ${updatedAds} bids changed.`;
  if (!createdAds && !updatedAds && !errors.length) return { ok: true, message: "All bids already match the tier rates." };
  return { ok: errors.length === 0, message: errors.length ? `${head} Problems: ${errors.slice(0, 3).join(" | ")}` : head };
}
