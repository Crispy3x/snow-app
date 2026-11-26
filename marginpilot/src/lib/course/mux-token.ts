import { createSign } from "node:crypto";

/**
 * Mux signed playback token (RS256 JWT). Claims per Mux docs:
 *   header { alg: "RS256", typ: "JWT", kid: <signing key id> }
 *   payload { sub: <playback id>, aud: "v" (video), exp: <unix seconds> }
 * The private key from the Mux dashboard is base64-encoded PEM; a raw PEM is accepted too.
 */

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64").replace(/=+$/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

export function decodeMuxPrivateKey(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("-----BEGIN")) return trimmed.replace(/\\n/g, "\n");
  return Buffer.from(trimmed, "base64").toString("utf8");
}

export function signMuxPlaybackToken(opts: {
  playbackId: string;
  keyId: string;
  privateKey: string;
  audience?: "v" | "t" | "g" | "s";
  expiresInSeconds?: number;
  now?: Date;
}): string {
  const iat = Math.floor((opts.now ?? new Date()).getTime() / 1000);
  const header = { alg: "RS256", typ: "JWT", kid: opts.keyId };
  const payload = { sub: opts.playbackId, aud: opts.audience ?? "v", exp: iat + (opts.expiresInSeconds ?? 6 * 3600) };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signature = createSign("RSA-SHA256").update(signingInput).sign(decodeMuxPrivateKey(opts.privateKey));
  return `${signingInput}.${base64url(signature)}`;
}

/** Returns a token when MUX_SIGNING_KEY_ID and MUX_SIGNING_PRIVATE_KEY are set, else null (public playback). */
export function muxTokenFromEnv(playbackId: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const keyId = env.MUX_SIGNING_KEY_ID;
  const privateKey = env.MUX_SIGNING_PRIVATE_KEY;
  if (!keyId || !privateKey) return null;
  return signMuxPlaybackToken({ playbackId, keyId, privateKey });
}
