import { computeMargin, type GuardRules } from "@/lib/margin";
import { guardAdRate } from "./pricing";

/**
 * Cleanup: find stale listings (no views, no sales) and suggest replacements. Pure, no I/O.
 */

export type CleanupListing = {
  id: string;
  status: string;
  listedAt: string | null;
  views: number;
  sold: number;
  price: number;
  supplierId: string | null;
};

export type CleanupCandidate = { listingId: string; ageDays: number; reason: string };

const DAY = 86_400_000;

export function selectCleanupCandidates(
  listings: CleanupListing[],
  afterDays: number,
  now: Date,
  skip: Set<string> = new Set(),
): CleanupCandidate[] {
  if (!(afterDays > 0)) return [];
  const out: CleanupCandidate[] = [];
  for (const l of listings) {
    if (l.status !== "active" || !l.listedAt || skip.has(l.id)) continue;
    const ageDays = Math.floor((now.getTime() - Date.parse(l.listedAt)) / DAY);
    if (ageDays <= afterDays) continue;
    if (l.views > 0 || l.sold > 0) continue;
    out.push({ listingId: l.id, ageDays, reason: `Listed ${ageDays} days ago with 0 views and 0 sales.` });
  }
  return out.sort((a, b) => b.ageDays - a.ageDays);
}

export type ReplacementProduct = {
  id: string;
  supplierId: string;
  cost: number | null;
  shippingCost: number;
  stock: number | null;
};

/**
 * Best replacement from the same supplier: in stock, not listed yet in this store,
 * and the highest margin at the price point of the listing it replaces (worst-case
 * ad rate and sale discount). Must pass the floor at that price.
 */
export function pickReplacement(
  stale: Pick<CleanupListing, "price" | "supplierId">,
  products: ReplacementProduct[],
  listedProductIds: Set<string>,
  rules: GuardRules,
  used: Set<string> = new Set(),
): { productId: string; marginPct: number } | null {
  if (!stale.supplierId || !(stale.price > 0)) return null;
  const worst = { ...rules, adRatePct: guardAdRate(rules, stale.price) };
  let best: { productId: string; marginPct: number } | null = null;
  for (const p of products) {
    if (p.supplierId !== stale.supplierId || listedProductIds.has(p.id) || used.has(p.id)) continue;
    if (p.cost === null || !(p.stock && p.stock > 0)) continue;
    const m = computeMargin(stale.price, { supplierCost: p.cost, supplierShipping: p.shippingCost }, worst).marginPct;
    if (m < rules.minNetMarginPct) continue;
    if (!best || m > best.marginPct) best = { productId: p.id, marginPct: m };
  }
  return best;
}
