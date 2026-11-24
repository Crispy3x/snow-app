import { cacheLife, cacheTag } from "next/cache";
import { createPublicClient } from "@/lib/supabase/public";

export const PROOF_CACHE_TAG = "proof";

export type PublicScreenshot = {
  id: string;
  caption: string;
  store_label: string;
  range_start: string;
  range_end: string;
  captured_on: string;
  public_image_path: string;
  image_width: number | null;
  image_height: number | null;
};

export type PublicTestimonial = {
  id: string;
  name: string;
  quote: string;
  store_type: string;
  photo_public_path: string | null;
  given_on: string;
};

/**
 * Approved proof only. RLS on both tables also enforces status = 'approved'
 * (and permission_given for testimonials), so this filter is belt and braces.
 * Cached and tagged; the admin approval action calls revalidateTag(PROOF_CACHE_TAG).
 */
export async function getApprovedProof(): Promise<{
  screenshots: PublicScreenshot[];
  testimonials: PublicTestimonial[];
}> {
  "use cache";
  cacheTag(PROOF_CACHE_TAG);
  cacheLife("hours");

  const supabase = createPublicClient();
  if (!supabase) return { screenshots: [], testimonials: [] };

  const [shots, quotes] = await Promise.all([
    supabase
      .from("proof_screenshots")
      .select("id, caption, store_label, range_start, range_end, captured_on, public_image_path, image_width, image_height")
      .eq("status", "approved")
      .not("public_image_path", "is", null)
      .order("sort_order", { ascending: true })
      .order("captured_on", { ascending: false }),
    supabase
      .from("testimonials")
      .select("id, name, quote, store_type, photo_public_path, given_on")
      .eq("status", "approved")
      .eq("permission_given", true)
      .order("sort_order", { ascending: true })
      .order("given_on", { ascending: false }),
  ]);

  return {
    screenshots: (shots.data as PublicScreenshot[] | null) ?? [],
    testimonials: (quotes.data as PublicTestimonial[] | null) ?? [],
  };
}

export function publicProofUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return `${base}/storage/v1/object/public/proof-public/${path}`;
}
