/**
 * Referral codes and the first-touch referral cookie. Pure functions with no
 * server-only import, so proxy.ts, server code and tests can all use them.
 *
 * Codes are 8 characters from an alphabet without look-alikes (no 0/O, 1/I/L),
 * so they survive being read aloud or typed from a screenshot.
 */

export const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const CODE_LENGTH = 8;
const CODE_PATTERN = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6,12}$/;

/** httpOnly cookie that remembers who referred this browser. */
export const REF_COOKIE = "mp_ref";
export const REF_COOKIE_MAX_AGE = 60 * 24 * 60 * 60; // 60 days, in seconds

type RandomBytes = (n: number) => Uint8Array;
const cryptoBytes: RandomBytes = (n) => crypto.getRandomValues(new Uint8Array(n));

/** A random code. Rejection sampling keeps every character equally likely. */
export function generateCode(randomBytes: RandomBytes = cryptoBytes, length = CODE_LENGTH): string {
  const n = CODE_ALPHABET.length;
  const limit = 256 - (256 % n); // bytes at or above this would bias the first characters
  let out = "";
  while (out.length < length) {
    for (const b of randomBytes(length * 2)) {
      if (b >= limit) continue;
      out += CODE_ALPHABET[b % n];
      if (out.length === length) break;
    }
  }
  return out;
}

/** Trimmed and upper-cased; null when it can't be a code. */
export function normalizeCode(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.trim().toUpperCase();
  return CODE_PATTERN.test(code) ? code : null;
}

export function isValidCode(raw: string | null | undefined): boolean {
  return normalizeCode(raw) !== null;
}

/**
 * First-touch rule: the code to store in the cookie for this request, or null
 * to leave the cookie alone (no valid ?ref=, or a valid referral is already stored).
 */
export function refCookieToSet(existingCookie: string | null | undefined, refParam: string | null | undefined): string | null {
  if (isValidCode(existingCookie)) return null;
  return normalizeCode(refParam);
}

export function referralLinks(baseUrl: string, code: string): { home: string; signup: string } {
  const base = baseUrl.replace(/\/+$/, "");
  return { home: `${base}/?ref=${code}`, signup: `${base}/signup?ref=${code}` };
}

/** "Jordan Smith" -> "J." What a referrer sees about the person they referred. */
export function maskedName(fullName: string | null | undefined): string {
  const first = (fullName ?? "").trim().match(/\p{L}|\p{N}/u)?.[0];
  return first ? `${first.toUpperCase()}.` : "Someone";
}
