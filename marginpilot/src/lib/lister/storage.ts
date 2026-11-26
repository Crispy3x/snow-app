import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Listing images in Supabase Storage.
 *
 * URL strategy: the listing-images bucket stays PRIVATE (0001_init.sql). eBay
 * must fetch picture URLs without auth, so listings.images stores a long-lived
 * signed URL (10 years) for each cleaned image. eBay copies pictures into its own
 * picture service when an offer is published or revised, so after that the URL is
 * no longer needed by eBay. Paths are unguessable (<org>/<listing>/<uuid>.jpg),
 * and nothing else in the bucket is exposed. To rotate, re-sign from the path.
 *
 * Pending (not yet approved) results go to <org>/pending/<uuid>.jpg with a short
 * signed URL for the preview and are moved on approval or removed on discard.
 */

export const BUCKET = "listing-images";
const TEN_YEARS = 60 * 60 * 24 * 365 * 10;

export async function uploadImage(path: string, data: Buffer, contentType = "image/jpeg") {
  const db = createAdminClient();
  const { error } = await db.storage.from(BUCKET).upload(path, data, { contentType, upsert: true });
  if (error) throw new Error(`Image upload failed: ${error.message}`);
}

export async function signedUrl(path: string, seconds = TEN_YEARS): Promise<string> {
  const db = createAdminClient();
  const { data, error } = await db.storage.from(BUCKET).createSignedUrl(path, seconds);
  if (error || !data) throw new Error(`Couldn't create an image URL: ${error?.message ?? "unknown"}`);
  return data.signedUrl;
}

export async function moveImage(from: string, to: string) {
  const db = createAdminClient();
  const { error } = await db.storage.from(BUCKET).move(from, to);
  if (error) throw new Error(`Couldn't save the image: ${error.message}`);
}

export async function removeImage(path: string) {
  await createAdminClient().storage.from(BUCKET).remove([path]);
}

function privateIp(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80")) return true;
    const m = v.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return m ? privateIp(m[1]) : false;
  }
  const [a, b] = ip.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

const MAX_BYTES = 8 * 1024 * 1024;

/**
 * Download an image from a user-supplied URL with SSRF guards: https/http only,
 * no private or loopback addresses, no redirects to them, image content types only, 8 MB cap.
 */
export async function fetchImage(rawUrl: string, redirects = 3): Promise<{ data: Buffer; contentType: string }> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("That isn't a valid image URL.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Image URLs must start with https://");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) throw new Error("That image address isn't allowed.");
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
  if (!addrs.length) throw new Error("Couldn't reach that image address.");
  if (addrs.some((a) => privateIp(a.address))) throw new Error("That image address isn't allowed.");

  const res = await fetch(url, { redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(15_000) });
  if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
    if (redirects <= 0) throw new Error("Too many redirects fetching the image.");
    return fetchImage(new URL(res.headers.get("location")!, url).toString(), redirects - 1);
  }
  if (!res.ok) throw new Error(`Couldn't download the image (HTTP ${res.status}).`);
  const contentType = (res.headers.get("content-type") ?? "").split(";")[0].trim();
  if (!/^image\/(jpeg|png|webp|gif)$/.test(contentType)) throw new Error("That URL isn't a JPEG, PNG, WebP or GIF image.");
  const len = Number(res.headers.get("content-length") ?? 0);
  if (len > MAX_BYTES) throw new Error("That image is larger than 8 MB.");
  const data = Buffer.from(await res.arrayBuffer());
  if (data.length > MAX_BYTES) throw new Error("That image is larger than 8 MB.");
  return { data, contentType };
}
