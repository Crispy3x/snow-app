import { cacheLife } from "next/cache";
import { isSaleActive } from "@/config/plans";

/**
 * Whether the sale is open right now, for rendering. Cached for a few minutes so
 * pages can prerender, and re-evaluated so the sale switches off on time.
 * (Checkout code calls isSaleActive(new Date()) directly at request time.)
 */
export async function saleIsOn(): Promise<boolean> {
  "use cache";
  cacheLife("minutes");
  return isSaleActive(new Date());
}
