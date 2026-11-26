import "server-only";
import { ebayHosts } from "./config";
import { EbayApiError, EbayRateLimitError, type EbayClient, type EbayRequestInit } from "./client";
import { appToken } from "./oauth";

/**
 * eBay calls for the stores area (connect flow, sync, notifications) that are
 * not in api.ts. Same conventions: typed wrappers, official REST APIs only.
 */

/**
 * A client for a raw access token, used during the OAuth callback before the
 * store row exists (e.g. to call the Identity API and learn the eBay user id).
 * No refresh: the token was issued seconds ago.
 */
export function clientForToken(accessToken: string, marketplaceId = "EBAY_US"): EbayClient {
  async function request<T>(path: string, init: EbayRequestInit = {}): Promise<T> {
    const url = new URL(path, init.host === "apiz" ? ebayHosts.apiz : ebayHosts.api);
    for (const [k, v] of Object.entries(init.query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));
    const res = await fetch(url, {
      method: init.method ?? "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-EBAY-C-MARKETPLACE-ID": marketplaceId,
        ...init.headers,
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      cache: "no-store",
    });
    if (res.status === 429) throw new EbayRateLimitError(Number(res.headers.get("retry-after")) || 60);
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    const json = text ? JSON.parse(text) : undefined;
    if (!res.ok) {
      const errors = json?.errors ?? [];
      throw new EbayApiError(errors[0]?.longMessage || errors[0]?.message || `eBay request failed (${res.status})`, res.status, errors);
    }
    return json as T;
  }
  return { storeId: "", marketplaceId, request };
}

/* ---------------- Application token (cached) ---------------- */

let appTokenCache: { token: string; expiresAt: number } | null = null;

/** Client-credentials token, cached in memory until 5 minutes before expiry. */
export async function cachedAppToken(): Promise<string> {
  if (appTokenCache && appTokenCache.expiresAt - Date.now() > 5 * 60_000) return appTokenCache.token;
  const t = await appToken();
  appTokenCache = { token: t.access_token, expiresAt: Date.now() + t.expires_in * 1000 };
  return t.access_token;
}

/* ---------------- Notification API ---------------- */

export type NotificationPublicKey = { key: string; algorithm: string; digest: string };

/** GET /commerce/notification/v1/public_key/{public_key_id} with an application token. */
export async function getNotificationPublicKey(kid: string): Promise<NotificationPublicKey> {
  const c = clientForToken(await cachedAppToken());
  return c.request<NotificationPublicKey>(`/commerce/notification/v1/public_key/${encodeURIComponent(kid)}`);
}

/* ---------------- Analytics (daily views for the dashboard) ---------------- */

const ymd = (d: Date) => d.toISOString().slice(0, 10).replaceAll("-", "");

export function getDailyTraffic(c: EbayClient, from: Date, to: Date) {
  return c.request<{
    records?: { dimensionValues: { value: string }[]; metricValues: { value: number }[] }[];
    header?: { metrics?: { key: string }[] };
  }>("/sell/analytics/v1/traffic_report", {
    query: {
      dimension: "DAY",
      metric: "LISTING_VIEWS_TOTAL",
      filter: `marketplace_ids:{${c.marketplaceId}},date_range:[${ymd(from)}..${ymd(to)}]`,
    },
  });
}
