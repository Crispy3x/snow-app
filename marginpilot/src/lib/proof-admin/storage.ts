import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Buckets from 0001_init.sql. */
export const BUCKETS = {
  originals: "proof-originals", // unredacted screenshots, admin only
  public: "proof-public", // redacted / approved copies only
  uploads: "testimonial-uploads", // testimonial photos before approval
} as const;

export async function download(db: SupabaseClient, bucket: string, path: string): Promise<Buffer> {
  const { data, error } = await db.storage.from(bucket).download(path);
  if (error || !data) throw new Error(`Couldn't read ${bucket}/${path}: ${error?.message ?? "not found"}`);
  return Buffer.from(await data.arrayBuffer());
}

export async function upload(
  db: SupabaseClient,
  bucket: string,
  path: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  const { error } = await db.storage.from(bucket).upload(path, body, {
    contentType,
    upsert: false,
    cacheControl: "31536000", // names are unique per version, so they can be cached forever
  });
  if (error) throw new Error(`Couldn't upload to ${bucket}: ${error.message}`);
}

/** Best-effort delete; logs instead of throwing so a DB change isn't undone by a storage hiccup. */
export async function removeQuietly(db: SupabaseClient, bucket: string, paths: (string | null | undefined)[]): Promise<void> {
  const list = paths.filter((p): p is string => !!p);
  if (list.length === 0) return;
  const { error } = await db.storage.from(bucket).remove(list);
  if (error) console.error(`storage remove failed in ${bucket}`, list, error.message);
}

/** Short random suffix so a re-published image gets a new URL (no stale CDN copies). */
export function versionSuffix(): string {
  return randomUUID().slice(0, 8);
}

export async function signedUrls(
  db: SupabaseClient,
  bucket: string,
  paths: (string | null | undefined)[],
  seconds = 600,
): Promise<Map<string, string>> {
  const list = [...new Set(paths.filter((p): p is string => !!p))];
  const out = new Map<string, string>();
  if (list.length === 0) return out;
  const { data } = await db.storage.from(bucket).createSignedUrls(list, seconds);
  for (const row of data ?? []) if (row.path && row.signedUrl) out.set(row.path, row.signedUrl);
  return out;
}
