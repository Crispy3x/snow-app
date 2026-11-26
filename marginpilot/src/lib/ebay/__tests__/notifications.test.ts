import { describe, expect, it, vi } from "vitest";
import { createHash, generateKeyPairSync, sign } from "node:crypto";

vi.mock("server-only", () => ({}));

import {
  cachedKeyFetcher,
  challengeResponse,
  handleDeletionNotification,
  parseNotification,
  parseSignatureHeader,
  verifySignature,
  type DeletionNotification,
} from "../notifications";

const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
// eBay sends PEM on one line, without newlines
const ebayStylePem = publicKey
  .export({ type: "spki", format: "pem" })
  .toString()
  .replace(/\n/g, "");
const other = generateKeyPairSync("ec", { namedCurve: "prime256v1" });

const body = JSON.stringify({
  metadata: { topic: "MARKETPLACE_ACCOUNT_DELETION", schemaVersion: "1.0", deprecated: false },
  notification: {
    notificationId: "49feeaeb-4982-42d9-a377-9645b8479411_33f7e043-fed8-442b-9d44-791923bd9a6d",
    eventDate: "2026-11-20T20:43:59.462Z",
    publishDate: "2026-11-20T20:43:59.679Z",
    publishAttemptCount: 1,
    data: { username: "test_user", userId: "ma8vp1jySJC", eiasToken: "nY+sHZ2PrBmdj6wVnY+sEZ2PrA2dj6wJnY+gAZGEpwmdj6x9nY+seQ==" },
  },
});

function header(payload: string, key = privateKey, kid = "kid-1") {
  const signature = sign("sha1", Buffer.from(payload), { key, dsaEncoding: "der" }).toString("base64");
  return Buffer.from(JSON.stringify({ alg: "ECDSA", kid, signature, digest: "SHA1" })).toString("base64");
}

function deps() {
  const seen = new Set<string>();
  return {
    getPublicKey: vi.fn(async () => ({ key: ebayStylePem, digest: "SHA1" })),
    record: vi.fn(async (n: DeletionNotification) => {
      if (seen.has(n.notificationId)) return "duplicate" as const;
      seen.add(n.notificationId);
      return "new" as const;
    }),
  };
}

describe("challengeResponse", () => {
  it("is sha256 hex of challenge + token + endpoint", () => {
    const code = "a8628072-3d33-45ee-9004-bee86830a22d";
    const token = "verification_token_0123456789_abcdefghijk";
    const url = "https://example.com/api/ebay/notifications/account-deletion";
    const expected = createHash("sha256").update(code + token + url).digest("hex");
    expect(challengeResponse(code, token, url)).toBe(expected);
    expect(expected).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("signature verification", () => {
  it("parses the base64 JSON header", () => {
    const h = parseSignatureHeader(header(body));
    expect(h?.kid).toBe("kid-1");
    expect(parseSignatureHeader("not-base64-json")).toBeNull();
    expect(parseSignatureHeader(null)).toBeNull();
  });

  it("accepts a valid ECDSA SHA1 signature with a one-line PEM", () => {
    const h = parseSignatureHeader(header(body))!;
    expect(verifySignature(body, h, ebayStylePem)).toBe(true);
  });

  it("accepts a signature over the re-serialised JSON (eBay SDK behaviour)", () => {
    const pretty = JSON.stringify(JSON.parse(body), null, 2);
    const h = parseSignatureHeader(header(body))!; // signed compact, received pretty
    expect(verifySignature(pretty, h, ebayStylePem)).toBe(true);
  });

  it("rejects a tampered body, another key, or a garbage key", () => {
    const h = parseSignatureHeader(header(body))!;
    expect(verifySignature(body.replace("test_user", "someone"), h, ebayStylePem)).toBe(false);
    const wrong = parseSignatureHeader(header(body, other.privateKey))!;
    expect(verifySignature(body, wrong, ebayStylePem)).toBe(false);
    expect(verifySignature(body, h, "-----BEGIN PUBLIC KEY-----abc-----END PUBLIC KEY-----")).toBe(false);
  });
});

describe("handleDeletionNotification", () => {
  it("returns 204 and records a valid notification", async () => {
    const d = deps();
    const r = await handleDeletionNotification(body, header(body), d);
    expect(r.status).toBe(204);
    expect(r).toMatchObject({ isNew: true, notification: { ebayUserId: "ma8vp1jySJC", username: "test_user" } });
    expect(d.getPublicKey).toHaveBeenCalledWith("kid-1");
  });

  it("is idempotent: a redelivery is acknowledged but not new", async () => {
    const d = deps();
    await handleDeletionNotification(body, header(body), d);
    const again = await handleDeletionNotification(body, header(body), d);
    expect(again).toMatchObject({ status: 204, isNew: false });
    expect(d.record).toHaveBeenCalledTimes(2);
  });

  it("returns 412 on a bad or missing signature and stores nothing", async () => {
    const d = deps();
    expect((await handleDeletionNotification(body, header(body, other.privateKey), d)).status).toBe(412);
    expect((await handleDeletionNotification(body, null, d)).status).toBe(412);
    expect((await handleDeletionNotification(body + " ", "e30=", d)).status).toBe(412); // "{}" header
    expect(d.record).not.toHaveBeenCalled();
  });

  it("returns 500 when the public key cannot be fetched, so eBay retries", async () => {
    const d = deps();
    d.getPublicKey.mockRejectedValueOnce(new Error("down"));
    expect((await handleDeletionNotification(body, header(body), d)).status).toBe(500);
  });

  it("ignores other topics with 204", async () => {
    const other = body.replace("MARKETPLACE_ACCOUNT_DELETION", "ITEM_SOLD");
    const r = await handleDeletionNotification(other, header(other), deps());
    expect(r).toEqual({ status: 204, ignored: true });
  });

  it("returns 400 for a signed but unrecognised body", async () => {
    const junk = JSON.stringify({ hello: "world" });
    expect((await handleDeletionNotification(junk, header(junk), deps())).status).toBe(400);
  });
});

describe("helpers", () => {
  it("parseNotification extracts ids", () => {
    expect(parseNotification(body)?.notificationId).toContain("49feeaeb");
    expect(parseNotification("{")).toBeNull();
  });

  it("cachedKeyFetcher fetches each kid once", async () => {
    const f = vi.fn(async () => ({ key: "k" }));
    const c = cachedKeyFetcher(f);
    await c("a");
    await c("a");
    await c("b");
    expect(f).toHaveBeenCalledTimes(2);
  });
});
