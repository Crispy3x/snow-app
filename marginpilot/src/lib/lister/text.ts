/**
 * Clean-up applied in code to every AI (or supplier) title and description,
 * so promo spam, links and contact details never reach eBay even if the model
 * lets them through. Pure functions, unit tested.
 */

export const TITLE_MAX = 80;

/** Listings per title-optimizer batch. */
export const MAX_TITLE_BATCH = 25;

/** Supplier promo phrases that don't belong on eBay. */
const PROMO = [
  /\bhot\s*sale\b/gi, /\bbig\s*sale\b/gi, /\bflash\s*sale\b/gi, /\bclearance\b/gi, /\blimited\s*time\b/gi,
  /\b\d{1,2}\s*%\s*off\b/gi, /\bcoupons?\b(?:\s*code)?(?:\s*(?=[A-Z]*\d)[A-Z0-9]{4,})?/gi, /\bpromo\s*code\b(?:\s*(?=[A-Z]*\d)[A-Z0-9]{4,})?/gi,
  /\bfree\s*shipping\b/gi, /\bbest\s*seller\b/gi, /\bwholesale\b/gi, /\bdrop\s*ship(?:ping)?\b/gi,
  /\bfactory\s*(?:direct|price|outlet)\b/gi, /\bbuy\s*now\b/gi, /\bnew\s*arrivals?\b/gi, /\b2\d{3}\s*new\b/gi,
  /\bdiscount\b/gi, /\bcheap(?:est)?\b/gi, /\bon\s*sale\b/gi,
];

const URL_RE = /\b(?:https?:\/\/|www\.)\S+/gi;
const DOMAIN_RE = /\b[\w-]+\.(?:com|net|org|io|co|shop|store|cn|biz)(?:\/\S*)?\b/gi;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_RE = /(\+?\d[\d\s().-]{8,}\d)/g;
const CONTACT_RE = /\b(?:whats\s?app|wechat|telegram|skype|contact us|call us|email us|message us)\b[^.\n]*[.\n]?/gi;

function stripPromo(s: string): string {
  let out = s;
  for (const re of PROMO) out = out.replace(re, " ");
  return out;
}

/** Turn an ALL CAPS word into Title Case, keeping short acronyms (USB, LED, 3D, XL). */
function fixCaps(word: string): string {
  if (word.length <= 4 || /\d/.test(word)) return word;
  if (word === word.toUpperCase() && /[A-Z]/.test(word)) return word[0] + word.slice(1).toLowerCase();
  return word;
}

/** eBay-safe title: no promo words, symbol spam or ALL CAPS, max 80 chars cut on a word. */
export function sanitizeTitle(title: string): string {
  let t = stripPromo(title)
    .replace(URL_RE, " ")
    .replace(/[!*~#$%^=<>{}[\]|\\@]+/g, " ") // symbol spam
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, " ") // emoji / dingbats
    .replace(/[™®©]/g, "")
    .replace(/\s*-\s*-+\s*/g, " - ")
    .replace(/\s+/g, " ")
    .trim();
  t = t.split(" ").map(fixCaps).join(" ");
  t = t.replace(/^[\s,;:/-]+|[\s,;:/-]+$/g, "");
  if (t.length <= TITLE_MAX) return t;
  const cut = t.slice(0, TITLE_MAX + 1);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 40 ? cut.slice(0, lastSpace) : t.slice(0, TITLE_MAX)).replace(/[\s,;:/-]+$/g, "");
}

const ALLOWED_TAGS = new Set(["p", "br", "ul", "ol", "li", "strong", "b", "em", "i", "h3", "h4"]);

/**
 * eBay-safe description: simple HTML only (p, br, lists, strong/em, h3/h4), no attributes,
 * no scripts, links, emails, phone numbers, contact prompts or supplier promo lines.
 */
export function sanitizeDescription(html: string): string {
  let s = html
    .replace(/<(script|style|iframe|object|embed|form)[\s\S]*?<\/\1>/gi, "")
    .replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, "$1")
    .replace(/<\/?([a-z0-9]+)\b[^>]*>/gi, (m, tag: string) => {
      const t = tag.toLowerCase();
      if (!ALLOWED_TAGS.has(t)) return " ";
      return m.startsWith("</") ? `</${t}>` : t === "br" ? "<br>" : `<${t}>`;
    })
    .replace(URL_RE, "")
    .replace(EMAIL_RE, "")
    .replace(CONTACT_RE, "")
    .replace(PHONE_RE, (m) => (m.replace(/\D/g, "").length >= 10 ? "" : m))
    .replace(DOMAIN_RE, "");
  s = stripPromo(s)
    .replace(/[!]{2,}/g, "!")
    .replace(/[ \t]+/g, " ")
    .replace(/\s+([.,!?;:])/g, "$1")
    .replace(/<p>\s*[.,!?;:\s]*<\/p>/g, "")
    .replace(/<li>\s*[.,!?;:\s]*<\/li>/g, "")
    .trim();
  if (!/<(p|ul|ol|h3|h4)>/.test(s)) {
    s = s
      .split(/\n{2,}/)
      .map((para) => para.trim())
      .filter(Boolean)
      .map((para) => `<p>${para.replace(/\n/g, "<br>")}</p>`)
      .join("");
  }
  return s;
}

/** Plain text from simple HTML, for previews and prompts. */
export function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|h3|h4)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
