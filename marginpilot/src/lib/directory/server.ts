import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { AppContext } from "@/lib/auth";
import { planHasDirectory } from "./entitlement";
import { DETAIL_COLUMNS, LIST_COLUMNS, type DirectoryListRow, type DirectorySupplier } from "./types";
import { sortDirectory } from "./filter";

/** Data reads for /app/directory. All go through the user's client, so RLS applies. */

export function directoryAccess(ctx: Pick<AppContext, "org" | "user">) {
  const entitled = planHasDirectory(ctx.org.plan);
  return { entitled, canView: entitled || ctx.user.isAdmin, adminPreview: !entitled && ctx.user.isAdmin };
}

export async function publishedCount(): Promise<number> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("directory_published_count");
  return typeof data === "number" ? data : 0;
}

export async function listPublished(): Promise<DirectoryListRow[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("directory_suppliers").select(LIST_COLUMNS).eq("status", "published");
  return sortDirectory((data ?? []) as unknown as DirectoryListRow[]);
}

export async function getPublished(id: string): Promise<DirectorySupplier | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("directory_suppliers").select(DETAIL_COLUMNS).eq("id", id).eq("status", "published").maybeSingle();
  return (data as unknown as DirectorySupplier) ?? null;
}

export type FavoriteRow = { directory_supplier_id: string; is_favorite: boolean; note: string | null; updated_at: string };

export async function getFavorites(orgId: string): Promise<Map<string, FavoriteRow>> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("directory_favorites")
    .select("directory_supplier_id, is_favorite, note, updated_at")
    .eq("org_id", orgId);
  return new Map(((data ?? []) as FavoriteRow[]).map((r) => [r.directory_supplier_id, r]));
}

/** Directory ids already added to this workspace's suppliers, mapped to the supplier row id. */
export async function linkedSuppliers(orgId: string): Promise<Map<string, string>> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("suppliers")
    .select("id, directory_id:config->>directory_id")
    .eq("org_id", orgId)
    .not("config->>directory_id", "is", null);
  return new Map(((data ?? []) as unknown as { id: string; directory_id: string }[]).map((r) => [r.directory_id, r.id]));
}

export async function storeHandlingDays(storeId: string | null | undefined): Promise<number | null> {
  if (!storeId) return null;
  const supabase = await createClient();
  const { data } = await supabase.from("store_rules").select("handling_days").eq("store_id", storeId).maybeSingle();
  return data?.handling_days ?? null;
}
