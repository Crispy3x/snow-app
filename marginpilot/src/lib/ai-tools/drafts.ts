import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

export type DraftStatus = "draft" | "approved" | "rejected" | "applied";

/**
 * Records what the user did with an AI draft. Always scoped to the caller's org
 * (pass ctx.org.id from getAppContext, never an id from the client alone).
 */
export async function setAiDraftStatus(orgId: string, requestId: string | null | undefined, status: DraftStatus): Promise<boolean> {
  if (!requestId) return false;
  const db = createAdminClient();
  const { data } = await db
    .from("ai_requests")
    .update({ draft_status: status })
    .eq("id", requestId)
    .eq("org_id", orgId)
    .select("id");
  return (data?.length ?? 0) > 0;
}

export const isUuid = (s: unknown): s is string =>
  typeof s === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
