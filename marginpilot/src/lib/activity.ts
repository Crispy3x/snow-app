import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Records everything the automation (or a user through it) changed.
 * Set undoable + before when the change can be reversed through the eBay API
 * (price, quantity, ending a listing). See src/lib/undo.ts for the reversers.
 */
export type ActivityEntry = {
  orgId: string;
  storeId?: string | null;
  actor: "automation" | "user" | "system";
  userId?: string | null;
  entityType: "listing" | "order" | "offer" | "promotion" | "store" | "rules" | "proposal" | "message";
  entityId?: string | null;
  action: string; // e.g. "price_changed", "quantity_set", "listing_ended", "tracking_posted"
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  undoable?: boolean;
};

export async function logActivity(e: ActivityEntry): Promise<number | null> {
  const db = createAdminClient();
  const { data, error } = await db
    .from("activity_log")
    .insert({
      org_id: e.orgId,
      store_id: e.storeId ?? null,
      actor: e.actor,
      user_id: e.userId ?? null,
      entity_type: e.entityType,
      entity_id: e.entityId ?? null,
      action: e.action,
      before: e.before ?? null,
      after: e.after ?? null,
      undoable: e.undoable ?? false,
    })
    .select("id")
    .single();
  if (error) console.error("activity log insert failed", error.message);
  return (data?.id as number) ?? null;
}
