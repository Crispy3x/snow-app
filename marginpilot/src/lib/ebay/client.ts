import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { decrypt, encrypt } from "@/lib/crypto";
import { ebayHosts } from "./config";
import { EbayAuthError, refreshAccessToken } from "./oauth";

/**
 * Authenticated eBay REST client for one connected store.
 * - refreshes the access token when it's within 5 minutes of expiry, or on a 401
 * - marks the store needs_reauth if the refresh token is no longer valid
 * - surfaces 429s as EbayRateLimitError so background jobs can back off (Inngest RetryAfterError)
 */

export type EbayErrorDetail = { errorId?: number; message?: string; longMessage?: string; domain?: string };

export class EbayApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public errors: EbayErrorDetail[] = [],
  ) {
    super(message);
    this.name = "EbayApiError";
  }
}

export class EbayRateLimitError extends EbayApiError {
  constructor(public retryAfterSeconds: number) {
    super(`eBay rate limit reached; retry after ${retryAfterSeconds}s`, 429);
    this.name = "EbayRateLimitError";
  }
}

export type EbayRequestInit = {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  /** "apiz" for Identity/Analytics endpoints served from apiz.ebay.com */
  host?: "api" | "apiz";
  headers?: Record<string, string>;
};

export interface EbayClient {
  storeId: string;
  marketplaceId: string;
  request<T = unknown>(path: string, init?: EbayRequestInit): Promise<T>;
}

type StoreTokenRow = {
  id: string;
  marketplace_id: string;
  access_token_enc: string | null;
  refresh_token_enc: string | null;
  access_expires_at: string | null;
};

async function loadStore(storeId: string): Promise<StoreTokenRow> {
  const db = createAdminClient();
  const { data, error } = await db
    .from("ebay_stores")
    .select("id, marketplace_id, access_token_enc, refresh_token_enc, access_expires_at")
    .eq("id", storeId)
    .single();
  if (error || !data) throw new EbayApiError("Store not found", 404);
  return data as StoreTokenRow;
}

async function refresh(store: StoreTokenRow): Promise<string> {
  const db = createAdminClient();
  if (!store.refresh_token_enc) throw new EbayAuthError("No refresh token");
  try {
    const t = await refreshAccessToken(decrypt(store.refresh_token_enc));
    const expires = new Date(Date.now() + t.expires_in * 1000).toISOString();
    await db
      .from("ebay_stores")
      .update({ access_token_enc: encrypt(t.access_token), access_expires_at: expires, status: "active" })
      .eq("id", store.id);
    store.access_token_enc = encrypt(t.access_token);
    store.access_expires_at = expires;
    return t.access_token;
  } catch (e) {
    if (e instanceof EbayAuthError) {
      await db.from("ebay_stores").update({ status: "needs_reauth" }).eq("id", store.id);
    }
    throw e;
  }
}

export async function getEbayClient(storeId: string): Promise<EbayClient> {
  const store = await loadStore(storeId);

  async function token(force = false): Promise<string> {
    const exp = store.access_expires_at ? Date.parse(store.access_expires_at) : 0;
    if (!force && store.access_token_enc && exp - Date.now() > 5 * 60_000) return decrypt(store.access_token_enc);
    return refresh(store);
  }

  async function request<T>(path: string, init: EbayRequestInit = {}, retried = false): Promise<T> {
    const base = init.host === "apiz" ? ebayHosts.apiz : ebayHosts.api;
    const url = new URL(path, base);
    for (const [k, v] of Object.entries(init.query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));
    const res = await fetch(url, {
      method: init.method ?? "GET",
      headers: {
        Authorization: `Bearer ${await token()}`,
        "Content-Type": "application/json",
        "Content-Language": "en-US",
        Accept: "application/json",
        "X-EBAY-C-MARKETPLACE-ID": store.marketplace_id,
        ...init.headers,
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      cache: "no-store",
    });

    if (res.status === 401 && !retried) {
      await token(true);
      return request<T>(path, init, true);
    }
    if (res.status === 429) {
      throw new EbayRateLimitError(Number(res.headers.get("retry-after")) || 60);
    }
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    const json = text ? JSON.parse(text) : undefined;
    if (!res.ok) {
      const errors: EbayErrorDetail[] = json?.errors ?? [];
      throw new EbayApiError(errors[0]?.longMessage || errors[0]?.message || `eBay request failed (${res.status})`, res.status, errors);
    }
    return json as T;
  }

  return { storeId, marketplaceId: store.marketplace_id, request };
}
