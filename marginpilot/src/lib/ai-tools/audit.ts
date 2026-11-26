import { z } from "zod";
import { guardPrice, type GuardRules } from "@/lib/margin";
import { floorPrice } from "./pricing";

/**
 * Listing audit scoring. Pure and deterministic: the score decides which listings
 * the AI looks at; the AI only writes the recommendation and reasons.
 *
 * Score is 0–100 (higher is healthier):
 *   title       15  (eBay allows 80 chars; 65–80 is full use)
 *   images      15  (8+ photos)
 *   specifics   15  (10+ item specifics)
 *   margin      20  (passes the margin guard at worst-case ad rate)
 *   performance 35  (sales, then views/watchers per day; new listings get a neutral score)
 *   brand risk  −10 per VeRO-style flag
 */

export type AuditListingInput = {
  id: string;
  title: string;
  price: number;
  views: number;
  sold: number;
  watchers: number;
  /** Days since listed_at (or created_at). */
  ageDays: number;
  itemSpecificsCount: number;
  imageCount: number;
  /** Null when the supplier cost is unknown. */
  supplierCost: number | null;
  supplierShipping?: number;
};

export type AuditMetrics = {
  price: number;
  views: number;
  sold: number;
  watchers: number;
  ageDays: number;
  titleLength: number;
  itemSpecificsCount: number;
  imageCount: number;
  marginPct: number | null;
  marginOk: boolean | null;
  floorPrice: number | null;
  veroFlags: string[];
};

export type AuditScore = {
  listingId: string;
  score: number;
  parts: { title: number; images: number; specifics: number; margin: number; performance: number; brandPenalty: number };
  issues: string[];
  metrics: AuditMetrics;
  /** Code's own suggestion; used as a hint for the AI and as the fallback when AI is unavailable. */
  hint: AuditRecommendation;
};

export type AuditRecommendation = "fix" | "reprice" | "end" | "keep";

/** Brands that commonly enforce through eBay VeRO. A mention is a prompt to check authorisation, not proof of a problem. */
export const VERO_BRANDS = [
  "nike", "adidas", "apple", "disney", "louis vuitton", "gucci", "chanel", "rolex", "lego", "pokemon",
  "marvel", "nintendo", "sony", "samsung", "north face", "yeti", "stanley", "oakley", "ray-ban", "michael kors",
  "coach", "prada", "hermes", "tiffany", "pandora", "beats", "bose", "dyson", "otterbox", "hello kitty",
];
const RISKY_TERMS = ["replica", "inspired", "dupe", "knockoff", "knock-off", "style of", "look alike", "lookalike", "1:1", "aaa quality", "mirror quality"];

export function veroFlags(title: string): string[] {
  const t = ` ${title.toLowerCase()} `;
  const flags: string[] = [];
  for (const term of RISKY_TERMS) if (t.includes(term)) flags.push(`Title uses "${term}", which eBay treats as counterfeit wording`);
  for (const b of VERO_BRANDS) {
    const re = new RegExp(`[^a-z]${b.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&")}[^a-z]`);
    if (re.test(t)) flags.push(`Mentions the brand "${b}"; confirm you're authorised to sell it (VeRO)`);
  }
  return flags;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const r1 = (n: number) => Math.round(n * 10) / 10;

export function scoreListing(l: AuditListingInput, rules: GuardRules): AuditScore {
  const issues: string[] = [];
  const titleLength = l.title.trim().length;
  const flags = veroFlags(l.title);

  // Title: 0 at ≤30 chars, full at ≥65.
  const title = r1(clamp((titleLength - 30) / 35, 0, 1) * 15);
  if (titleLength < 65) issues.push(`Title uses ${titleLength} of 80 characters`);

  const images = r1(clamp(l.imageCount / 8, 0, 1) * 15);
  if (l.imageCount < 4) issues.push(l.imageCount === 0 ? "No photos" : `Only ${l.imageCount} photo${l.imageCount === 1 ? "" : "s"}`);

  const specifics = r1(clamp(l.itemSpecificsCount / 10, 0, 1) * 15);
  if (l.itemSpecificsCount < 6) issues.push(`Only ${l.itemSpecificsCount} item specifics`);

  let margin = 10;
  let marginPct: number | null = null;
  let marginOk: boolean | null = null;
  let floor: number | null = null;
  if (l.supplierCost !== null && l.price > 0) {
    const cost = { supplierCost: l.supplierCost, supplierShipping: l.supplierShipping ?? 0 };
    const g = guardPrice(l.price, cost, rules);
    marginPct = g.breakdown.marginPct;
    marginOk = g.ok;
    floor = floorPrice(cost, rules);
    if (g.ok) margin = 20;
    else {
      // Scale 0–10 by how close to the floor it is.
      margin = r1(clamp(marginPct / Math.max(rules.minNetMarginPct, 1), 0, 1) * 10);
      issues.push(`Margin ${marginPct}% is below the ${rules.minNetMarginPct}% floor`);
    }
  } else {
    issues.push("Supplier cost unknown, margin can't be checked");
  }

  const age = Math.max(l.ageDays, 0);
  let performance: number;
  if (age < 14 && l.sold === 0) {
    performance = 20; // too new to judge
  } else if (l.sold > 0) {
    performance = clamp(22 + l.sold * 3, 0, 35);
  } else {
    const viewsPerDay = l.views / Math.max(age, 1);
    performance = r1(clamp(viewsPerDay * 6 + l.watchers * 2, 0, 18));
    if (l.views === 0) issues.push(`No views in ${age} days`);
    else issues.push(`${l.views} views and no sales in ${age} days`);
  }

  const brandPenalty = -10 * flags.length;
  issues.push(...flags);

  const score = Math.round(clamp(title + images + specifics + margin + performance + brandPenalty, 0, 100));

  let hint: AuditRecommendation = "keep";
  if (age >= 60 && l.sold === 0 && l.views < 10) hint = "end";
  else if (marginOk === false) hint = "reprice";
  else if (flags.length || title < 10 || images < 8 || specifics < 9 || (age >= 30 && l.sold === 0)) hint = "fix";

  return {
    listingId: l.id,
    score,
    parts: { title, images, specifics, margin, performance, brandPenalty },
    issues,
    metrics: {
      price: l.price,
      views: l.views,
      sold: l.sold,
      watchers: l.watchers,
      ageDays: age,
      titleLength,
      itemSpecificsCount: l.itemSpecificsCount,
      imageCount: l.imageCount,
      marginPct,
      marginOk,
      floorPrice: floor,
      veroFlags: flags,
    },
    hint,
  };
}

/** Lowest scores first; ties broken by age (older first) so stale listings surface. */
export function rankForReview(scores: AuditScore[], limit = 50): AuditScore[] {
  return [...scores].sort((a, b) => a.score - b.score || b.metrics.ageDays - a.metrics.ageDays).slice(0, limit);
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export const AuditBatchSchema = z.object({
  items: z.array(
    z.object({
      listingId: z.string(),
      recommendation: z.enum(["fix", "reprice", "end", "keep"]),
      reasons: z.array(z.string()).describe("One to three short reasons tied to the metrics"),
      suggestedTitle: z.string().nullable().describe("A better title (max 80 chars) when the title is weak, else null"),
      suggestedPrice: z.number().nullable().describe("Only for reprice: a price at or above floorPrice, else null"),
      notes: z.string().nullable().describe("Other concrete changes, e.g. add photos or item specifics"),
    }),
  ),
});
export type AuditBatch = z.infer<typeof AuditBatchSchema>;

export const AUDIT_SYSTEM = `You audit eBay fixed-price listings for a seller. For each listing pick one recommendation:
- fix: the listing can sell with better title, photos, item specifics or brand-safe wording
- reprice: the margin fails the store's floor (raise to at least floorPrice) or price looks off versus the seller's own data
- end: stale (long age, few or no views, no sales) and not worth fixing, or a likely VeRO/counterfeit problem
- keep: healthy, leave it alone
Use only the metrics given. Never suggest a price below floorPrice. Titles must be 80 characters or fewer, without ALL CAPS or keyword stuffing, and must not add brand names that aren't already in the listing.
Return one item per listing, using its listingId exactly.`;

export function buildAuditPrompt(batch: { score: AuditScore; title: string }[]): string {
  return JSON.stringify(
    batch.map(({ score, title }) => ({
      listingId: score.listingId,
      title,
      score: score.score,
      codeHint: score.hint,
      issues: score.issues,
      ...score.metrics,
    })),
  );
}

/** Keep the AI to valid ids and enforce the floor in code. */
export function sanitizeAuditItem(item: AuditBatch["items"][number], score: AuditScore) {
  let price = item.suggestedPrice;
  if (price !== null) {
    if (!(price > 0)) price = null;
    else if (score.metrics.floorPrice !== null && price < score.metrics.floorPrice) price = score.metrics.floorPrice;
  }
  const title = item.suggestedTitle?.trim().slice(0, 80) || null;
  return {
    recommendation: item.recommendation,
    reasons: item.reasons.slice(0, 3).map((r) => r.slice(0, 300)),
    suggested_changes: title || price !== null || item.notes ? { title, price, notes: item.notes?.slice(0, 500) ?? null } : null,
  };
}
