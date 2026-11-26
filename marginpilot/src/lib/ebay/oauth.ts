import "server-only";
import { EBAY_SCOPES, ebayHosts } from "./config";

/**
 * eBay OAuth authorization-code flow (user consent). We receive tokens, never
 * the seller's password. Tokens are encrypted before they reach the database.
 */

export type EbayTokens = {
  access_token: string;
  expires_in: number; // seconds (about 2 hours)
  refresh_token?: string;
  refresh_token_expires_in?: number; // seconds (about 18 months)
  token_type: string;
};

function basicAuth() {
  const id = process.env.EBAY_CLIENT_ID!;
  const secret = process.env.EBAY_CLIENT_SECRET!;
  return "Basic " + Buffer.from(`${id}:${secret}`).toString("base64");
}

export function consentUrl(state: string): string {
  const u = new URL("/oauth2/authorize", ebayHosts.auth);
  u.searchParams.set("client_id", process.env.EBAY_CLIENT_ID!);
  u.searchParams.set("redirect_uri", process.env.EBAY_RU_NAME!);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", EBAY_SCOPES.join(" "));
  u.searchParams.set("state", state);
  u.searchParams.set("prompt", "login");
  return u.toString();
}

async function tokenRequest(body: Record<string, string>): Promise<EbayTokens> {
  const res = await fetch(new URL("/identity/v1/oauth2/token", ebayHosts.api), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: basicAuth() },
    body: new URLSearchParams(body),
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (json as { error_description?: string }).error_description ?? `token request failed (${res.status})`;
    throw new EbayAuthError(msg, (json as { error?: string }).error);
  }
  return json as EbayTokens;
}

export function exchangeCode(code: string) {
  return tokenRequest({ grant_type: "authorization_code", code, redirect_uri: process.env.EBAY_RU_NAME! });
}

export function refreshAccessToken(refreshToken: string) {
  return tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken, scope: EBAY_SCOPES.join(" ") });
}

/** Application token (client credentials), e.g. for the Notification API public key. */
export function appToken() {
  return tokenRequest({ grant_type: "client_credentials", scope: "https://api.ebay.com/oauth/api_scope" });
}

export class EbayAuthError extends Error {
  constructor(
    message: string,
    public code?: string,
  ) {
    super(message);
    this.name = "EbayAuthError";
  }
}
