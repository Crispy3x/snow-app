import { adRateForPrice, type AdRateTier } from "@/lib/margin";

/**
 * Promoted listings (cost per sale) bids by price tier. Pure, no I/O.
 * The bid is never above the rate the margin guard assumed (the top of the tier).
 */

export type BidStrategy = "min" | "mid" | "max";
export const CAMPAIGN_NAME = "MarginPilot";

const floor1 = (n: number) => Math.floor(n * 10 + 1e-9) / 10; // eBay bids have one decimal

/** Bid % for a listing price, or null when no tier covers it (no ad). */
export function bidForListing(tiers: AdRateTier[], price: number, strategy: BidStrategy): number | null {
  const range = adRateForPrice(tiers, price);
  if (!(range.max > 0)) return null;
  const raw = strategy === "min" ? range.min : strategy === "max" ? range.max : (range.min + range.max) / 2;
  const bid = Math.min(floor1(raw), range.max);
  return bid > 0 ? bid : null;
}
