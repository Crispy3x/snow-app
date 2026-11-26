/**
 * Only allow same-site relative paths as post-login destinations, so
 * ?next= can't be used as an open redirect (//evil.com, /\evil.com, https://...).
 */
export function safeNext(next: unknown, fallback = "/app"): string {
  if (typeof next !== "string" || next.length === 0 || next.length > 2048) return fallback;
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  // Reject control characters (incl. tab/newline, which browsers strip) and backslashes anywhere in the path part.
  if (/[\u0000-\u001f\u007f\\]/.test(next)) return fallback;
  return next;
}
