import { createVerify, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decodeMuxPrivateKey, muxTokenFromEnv, signMuxPlaybackToken } from "../mux-token";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
const b64 = Buffer.from(pem).toString("base64");

function decode(part: string) {
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
}

describe("signMuxPlaybackToken", () => {
  const now = new Date("2026-11-26T12:00:00Z");
  const token = signMuxPlaybackToken({ playbackId: "abc123XYZ456", keyId: "key_1", privateKey: b64, now, expiresInSeconds: 3600 });
  const [h, p, s] = token.split(".");

  it("is a three-part JWT with RS256 header and kid", () => {
    expect(token.split(".")).toHaveLength(3);
    expect(decode(h)).toEqual({ alg: "RS256", typ: "JWT", kid: "key_1" });
  });

  it("has Mux claims: sub = playback id, aud = v, exp", () => {
    expect(decode(p)).toEqual({ sub: "abc123XYZ456", aud: "v", exp: Math.floor(now.getTime() / 1000) + 3600 });
  });

  it("uses base64url without padding", () => {
    expect(token).not.toMatch(/[=+/]/);
  });

  it("verifies with the public key", () => {
    const ok = createVerify("RSA-SHA256").update(`${h}.${p}`).verify(publicKey, Buffer.from(s, "base64url"));
    expect(ok).toBe(true);
  });
});

describe("key handling", () => {
  it("accepts base64 or raw PEM (with escaped newlines)", () => {
    expect(decodeMuxPrivateKey(b64)).toBe(pem);
    expect(decodeMuxPrivateKey(pem.trim().replace(/\n/g, "\\n"))).toBe(pem.trim());
  });

  it("returns null without env keys", () => {
    expect(muxTokenFromEnv("abc123XYZ456", {} as NodeJS.ProcessEnv)).toBeNull();
    expect(
      muxTokenFromEnv("abc123XYZ456", { MUX_SIGNING_KEY_ID: "k", MUX_SIGNING_PRIVATE_KEY: b64 } as unknown as NodeJS.ProcessEnv),
    ).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/);
  });
});
