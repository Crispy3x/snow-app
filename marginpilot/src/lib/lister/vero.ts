/**
 * Deterministic VeRO (eBay Verified Rights Owner) check. Pure, no I/O.
 *
 * The AI listing writer also flags brand risk, but models miss things, so every
 * draft is also scanned in code against brands whose owners are known to report
 * listings often. Edit VERO_BRANDS to add or remove names; tests cover matching.
 * This is a warning aid, not legal advice: a hit means "check before listing".
 */

export type VeroRisk = "none" | "low" | "high";

export type VeroResult = {
  risk: VeroRisk;
  brandsMentioned: string[];
  reasons: string[];
};

/**
 * Commonly protected brand names (lowercase). Multi-word names are matched as
 * phrases. Short or ambiguous words (e.g. "apple", "coach", "puma", "gap") are
 * matched only in a product-ish context via AMBIGUOUS below.
 */
export const VERO_BRANDS: string[] = [
  "nike", "adidas", "jordan", "under armour", "new balance", "reebok", "vans", "converse", "asics", "skechers",
  "louis vuitton", "gucci", "chanel", "prada", "hermes", "burberry", "versace", "fendi", "dior", "balenciaga",
  "michael kors", "kate spade", "tory burch", "ray-ban", "rayban", "oakley", "rolex", "omega", "cartier", "tiffany",
  "pandora", "swarovski", "yeti", "stanley", "hydro flask", "lululemon", "the north face", "north face", "patagonia",
  "canada goose", "ugg", "crocs", "birkenstock", "dr. martens", "timberland",
  "apple", "airpods", "iphone", "ipad", "macbook", "samsung", "galaxy", "sony", "playstation", "nintendo", "xbox",
  "microsoft", "bose", "beats", "jbl", "dyson", "kitchenaid", "vitamix", "ninja", "instant pot", "keurig", "nespresso",
  "otterbox", "lifeproof", "anker", "gopro", "dji", "fitbit", "garmin", "logitech",
  "disney", "marvel", "pixar", "star wars", "pokemon", "pokémon", "hello kitty", "sanrio", "barbie", "hot wheels",
  "lego", "nerf", "funko", "harry potter", "minecraft", "fortnite", "paw patrol", "peppa pig", "bluey", "sesame street",
  "nfl", "nba", "mlb", "nhl", "fifa", "ferrari", "lamborghini", "porsche", "harley-davidson", "harley davidson",
  "coca-cola", "coca cola", "starbucks", "hershey", "john deere", "caterpillar", "stihl", "milwaukee", "dewalt", "makita",
  "olaplex", "mac cosmetics", "estee lauder", "clinique", "maybelline", "loreal", "l'oreal", "chi", "ghd",
  "coach", "puma", "gap", "guess", "fossil", "casio", "seiko", "levi's", "levis", "calvin klein", "tommy hilfiger",
  "ralph lauren", "polo", "supreme", "off-white", "bape", "stussy",
];

/** Brands that are ordinary words; only flagged when used like a brand. */
const AMBIGUOUS = new Set(["apple", "coach", "puma", "gap", "guess", "polo", "galaxy", "ninja", "beats", "stanley", "chi", "fossil", "jordan", "supreme", "omega", "pandora", "caterpillar", "milwaukee", "vans"]);

/** Phrases that signal counterfeits or riding on someone's trademark. */
const REPLICA = /\b(replica|knock[- ]?off|inspired by|dupe|1:1|aaa quality|mirror quality|fake|unbranded copy|look[- ]?alike)\b/i;
const COMPATIBLE = /\b(compatible with|fits|for use with|works with|replacement for|designed for)\s+(?:the\s+)?([A-Z][\w'&.-]*(?:\s+[A-Z][\w'&.-]*){0,2})/g;
const TM = /[™®]|\(tm\)|\(r\)/i;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function brandRegex(brand: string): RegExp {
  // word boundaries that also work for names with dots, apostrophes and accents
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(brand)}(?=$|[^\\p{L}\\p{N}])`, "iu");
}

/** Is an ambiguous brand word used as a brand (capitalised mid-sentence, or next to a product word)? */
function ambiguousAsBrand(text: string, brand: string): boolean {
  const cap = brand.replace(/(^|\s)\p{L}/gu, (m) => m.toUpperCase());
  const re = new RegExp(`(^|[^\\p{L}\\p{N}])(${escapeRe(cap)}|${escapeRe(brand.toUpperCase())})(?=$|[^\\p{L}\\p{N}])`, "u");
  return re.test(text);
}

export function findBrands(text: string, brands: string[] = VERO_BRANDS): string[] {
  const found = new Set<string>();
  for (const b of brands) {
    if (!brandRegex(b).test(text)) continue;
    if (AMBIGUOUS.has(b) && !ambiguousAsBrand(text, b)) continue;
    found.add(b);
  }
  // collapse aliases ("north face" inside "the north face")
  for (const b of [...found]) for (const o of found) if (o !== b && o.includes(b)) found.delete(b);
  return [...found];
}

/** Scan a title/description/specifics blob for VeRO risk. */
export function checkVero(text: string, brands: string[] = VERO_BRANDS): VeroResult {
  const reasons: string[] = [];
  const mentioned = findBrands(text, brands);
  let risk: VeroRisk = "none";

  const strong = mentioned.filter((b) => !AMBIGUOUS.has(b));
  const weak = mentioned.filter((b) => AMBIGUOUS.has(b));
  if (strong.length) {
    risk = "high";
    reasons.push(`Mentions protected brand${strong.length > 1 ? "s" : ""}: ${strong.join(", ")}. Only list genuine branded stock you can prove, or remove the name.`);
  }
  if (weak.length) {
    if (risk === "none") risk = "low";
    reasons.push(`May mention a protected brand: ${weak.join(", ")}. Check it's used as an ordinary word, not the brand.`);
  }
  if (REPLICA.test(text)) {
    risk = "high";
    reasons.push("Uses replica or 'inspired by' wording, which eBay treats as counterfeit.");
  }
  const compat = [...text.matchAll(COMPATIBLE)].map((m) => m[2]).filter((n) => findBrands(n, brands).length);
  if (compat.length) {
    if (risk === "none") risk = "low";
    reasons.push(`"Compatible with" brand phrasing (${[...new Set(compat)].join(", ")}). Allowed only when accurate; keep the brand out of the title's start and never imply it's made by them.`);
  }
  if (TM.test(text)) {
    if (risk === "none") risk = "low";
    reasons.push("Contains trademark symbols copied from the supplier text.");
  }
  return { risk, brandsMentioned: mentioned, reasons };
}

const RANK: Record<VeroRisk, number> = { none: 0, low: 1, high: 2 };

/** Combine the AI's VeRO view with the code check: highest risk wins, lists merged. */
export function combineVero(a: VeroResult, b: VeroResult): VeroResult {
  const risk = RANK[a.risk] >= RANK[b.risk] ? a.risk : b.risk;
  const brands = [...new Set([...a.brandsMentioned, ...b.brandsMentioned].map((s) => s.trim()).filter(Boolean).map((s) => s.toLowerCase()))];
  const reasons = [...new Set([...a.reasons, ...b.reasons].filter(Boolean))];
  return { risk, brandsMentioned: brands, reasons };
}
