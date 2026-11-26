import "server-only";
import { createHash, createPublicKey, verify, type KeyObject } from "node:crypto";

/**
 * eBay Marketplace Account Deletion notifications (mandatory for every app).
 * https://developer.ebay.com/marketplace-account-deletion
 *
 * GET  ?challenge_code=X  → {"challengeResponse": sha256hex(X + verificationToken + endpointUrl)}
 * POST JSON notification, signed: X-EBAY-SIGNATURE is base64(JSON {alg, kid, signature, digest}).
 *      The signature is ECDSA (DER, base64) with SHA1 over the message body, verified with the
 *      public key from the Notification API getPublicKey(kid). Bad signature → 412 (as eBay's
 *      own SDKs do), accepted → 204 straight away, deletion runs in a background job.
 *
 * This module is pure (no I/O of its own); callers pass the key fetcher and storage.
 */

export const DELETION_TOPIC = "MARKETPLACE_ACCOUNT_DELETION";

export function challengeResponse(challengeCode: string, verificationToken: string, endpointUrl: string): string {
  return createHash("sha256").update(challengeCode).update(verificationToken).update(endpointUrl).digest("hex");
}

export type SignatureHeader = { alg?: string; kid: string; signature: string; digest?: string };

export function parseSignatureHeader(header: string | null | undefined): SignatureHeader | null {
  if (!header) return null;
  try {
    const json = JSON.parse(Buffer.from(header, "base64").toString("utf8")) as Partial<SignatureHeader>;
    if (typeof json.kid !== "string" || typeof json.signature !== "string" || !json.kid || !json.signature) return null;
    return json as SignatureHeader;
  } catch {
    return null;
  }
}

/** eBay returns PEM without line breaks; rebuild a valid PEM before parsing. */
export function toPublicKey(pem: string): KeyObject {
  const body = pem
    .replace(/-----BEGIN PUBLIC KEY-----/, "")
    .replace(/-----END PUBLIC KEY-----/, "")
    .replace(/\s+/g, "");
  const lines = body.match(/.{1,64}/g)?.join("\n") ?? "";
  return createPublicKey(`-----BEGIN PUBLIC KEY-----\n${lines}\n-----END PUBLIC KEY-----\n`);
}

function digestName(d?: string) {
  const v = (d ?? "SHA1").toUpperCase().replace("-", "");
  return v === "SHA256" ? "sha256" : "sha1";
}

/** Verifies the signature over the raw body (and, as eBay's SDKs do, over the re-serialised JSON). */
export function verifySignature(rawBody: string, sig: SignatureHeader, publicKeyPem: string, digest?: string): boolean {
  let key: KeyObject;
  try {
    key = toPublicKey(publicKeyPem);
  } catch {
    return false;
  }
  const signature = Buffer.from(sig.signature, "base64");
  const alg = digestName(digest ?? sig.digest);
  const candidates = [rawBody];
  try {
    const reserialised = JSON.stringify(JSON.parse(rawBody));
    if (reserialised !== rawBody) candidates.push(reserialised);
  } catch {
    /* not JSON: only the raw body can match */
  }
  return candidates.some((c) => {
    try {
      return verify(alg, Buffer.from(c, "utf8"), { key, dsaEncoding: "der" }, signature);
    } catch {
      return false;
    }
  });
}

export type PublicKeyFetcher = (kid: string) => Promise<{ key: string; digest?: string }>;

/** Caches public keys by kid (eBay rotates rarely; an hour keeps it fresh). */
export function cachedKeyFetcher(fetcher: PublicKeyFetcher, ttlMs = 60 * 60_000): PublicKeyFetcher {
  const cache = new Map<string, { value: { key: string; digest?: string }; at: number }>();
  return async (kid) => {
    const hit = cache.get(kid);
    if (hit && Date.now() - hit.at < ttlMs) return hit.value;
    const value = await fetcher(kid);
    cache.set(kid, { value, at: Date.now() });
    return value;
  };
}

export type DeletionNotification = {
  notificationId: string;
  topic: string;
  ebayUserId: string | null;
  username: string | null;
  eventDate: string | null;
  payload: unknown;
};

export function parseNotification(rawBody: string): DeletionNotification | null {
  try {
    const json = JSON.parse(rawBody) as {
      metadata?: { topic?: string };
      notification?: { notificationId?: string; eventDate?: string; data?: { userId?: string; username?: string } };
    };
    const id = json.notification?.notificationId;
    const topic = json.metadata?.topic;
    if (!id || !topic) return null;
    return {
      notificationId: id,
      topic,
      ebayUserId: json.notification?.data?.userId ?? null,
      username: json.notification?.data?.username ?? null,
      eventDate: json.notification?.eventDate ?? null,
      payload: json,
    };
  } catch {
    return null;
  }
}

export type DeletionDeps = {
  getPublicKey: PublicKeyFetcher;
  /** Insert into ebay_notifications; "duplicate" when the notificationId was already stored. */
  record: (n: DeletionNotification) => Promise<"new" | "duplicate">;
};

export type DeletionResult =
  | { status: 204; notification: DeletionNotification; isNew: boolean }
  | { status: 204; ignored: true }
  | { status: 400 | 412 | 500; error: string };

/** The POST handler's logic, independent of Next.js so it can be unit tested. */
export async function handleDeletionNotification(
  rawBody: string,
  signatureHeader: string | null,
  deps: DeletionDeps,
): Promise<DeletionResult> {
  const sig = parseSignatureHeader(signatureHeader);
  if (!sig) return { status: 412, error: "missing or malformed X-EBAY-SIGNATURE" };

  let key: { key: string; digest?: string };
  try {
    key = await deps.getPublicKey(sig.kid);
  } catch {
    return { status: 500, error: "could not fetch eBay public key" }; // eBay retries on 5xx
  }
  if (!verifySignature(rawBody, sig, key.key, key.digest)) return { status: 412, error: "signature verification failed" };

  const n = parseNotification(rawBody);
  if (!n) return { status: 400, error: "unrecognised notification body" };
  if (n.topic !== DELETION_TOPIC) return { status: 204, ignored: true };

  try {
    const r = await deps.record(n);
    return { status: 204, notification: n, isNew: r === "new" };
  } catch {
    return { status: 500, error: "could not store notification" };
  }
}
