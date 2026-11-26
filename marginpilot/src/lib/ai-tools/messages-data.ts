import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { EbayApiError, getEbayClient } from "@/lib/ebay/client";
import { getConversation, getPolicies } from "@/lib/ebay/api";
import type { ConversationMessage, OrderContext } from "./messages";
import { isReconnectError } from "./messages";

/** Data for the buyer message assistant. Every DB query is filtered by org and store; no addresses are read. */

export const RECONNECT_MESSAGE =
  "We couldn't read your eBay messages. Reconnect your store on the eBay stores page and allow message access, then try again.";

export function ebayErrorMessage(e: unknown): { reconnect: boolean; message: string } {
  if (e instanceof EbayApiError) {
    if (isReconnectError(e.status, e.message)) return { reconnect: true, message: RECONNECT_MESSAGE };
    if (e.status === 429) return { reconnect: false, message: "eBay is rate limiting requests right now. Try again in a minute." };
    return { reconnect: false, message: `eBay returned an error: ${e.message}` };
  }
  if (e instanceof Error && /refresh token|reauth|EbayAuthError/i.test(`${e.name} ${e.message}`)) return { reconnect: true, message: RECONNECT_MESSAGE };
  return { reconnect: false, message: "Couldn't reach eBay. Please try again." };
}

export async function storeHasMessageScope(orgId: string, storeId: string): Promise<{ username: string | null; hasScope: boolean | null }> {
  const db = createAdminClient();
  const { data } = await db.from("ebay_stores").select("ebay_username, scopes, status").eq("id", storeId).eq("org_id", orgId).maybeSingle();
  const scopes = (data?.scopes as string[] | null) ?? [];
  return {
    username: (data?.ebay_username as string | null) ?? null,
    // Empty scopes means we don't know (older connections); let the API call decide.
    hasScope: data?.status === "needs_reauth" ? false : scopes.length ? scopes.some((s) => s.includes("commerce.message")) : null,
  };
}

export type LoadedConversation = {
  messages: (ConversationMessage & { sender: string })[];
  buyerUsername: string | null;
};

export async function loadConversation(storeId: string, conversationId: string, sellerUsername: string | null): Promise<LoadedConversation> {
  const c = await getEbayClient(storeId);
  const res = await getConversation(c, conversationId);
  const msgs = [...(res.messages ?? [])].sort((a, b) => a.createdDate.localeCompare(b.createdDate));
  const seller = sellerUsername?.toLowerCase();
  const messages = msgs.map((m) => ({
    sender: m.senderUsername,
    fromBuyer: seller ? m.senderUsername?.toLowerCase() !== seller : true,
    text: m.messageBody ?? "",
    date: m.createdDate,
  }));
  return { messages, buyerUsername: messages.find((m) => m.fromBuyer)?.sender ?? null };
}

/**
 * Finds the order this conversation is about: by eBay order id, then by the
 * listing (eBay item id) bought by this buyer. Returns status/tracking only.
 */
export async function findOrderContext(
  orgId: string,
  storeId: string,
  referenceId: string | null,
  buyerUsername: string | null,
): Promise<{ order: OrderContext | null; listingTitle: string | null }> {
  const db = createAdminClient();
  const select = "id, status, created_on_ebay, ship_by, order_lines(quantity, listing_id, listings(title)), fulfillments(carrier, tracking_number, posted_at)";
  type Row = {
    id: string;
    status: string;
    created_on_ebay: string | null;
    ship_by: string | null;
    order_lines: { quantity: number; listing_id: string | null; listings: { title: string } | null }[];
    fulfillments: { carrier: string; tracking_number: string; posted_at: string | null }[];
  };
  let row: Row | null = null;
  let listingTitle: string | null = null;

  if (referenceId) {
    const { data } = await db.from("orders").select(select).eq("org_id", orgId).eq("store_id", storeId).eq("ebay_order_id", referenceId).maybeSingle();
    row = data as unknown as Row | null;
    if (!row) {
      const { data: listing } = await db
        .from("listings")
        .select("id, title")
        .eq("org_id", orgId)
        .eq("store_id", storeId)
        .eq("ebay_listing_id", referenceId)
        .maybeSingle();
      if (listing) {
        listingTitle = listing.title;
        if (buyerUsername) {
          const { data: orders } = await db
            .from("orders")
            .select(`${select.replace("order_lines(", "order_lines!inner(")}`)
            .eq("org_id", orgId)
            .eq("store_id", storeId)
            .eq("buyer_username", buyerUsername)
            .eq("order_lines.listing_id", listing.id)
            .order("created_on_ebay", { ascending: false })
            .limit(1);
          row = (orders?.[0] as unknown as Row) ?? null;
        }
      }
    }
  }
  if (!row && buyerUsername) {
    // Most recent order from this buyer in this store (last 90 days).
    const since = new Date(Date.now() - 90 * 86_400_000).toISOString();
    const { data } = await db
      .from("orders")
      .select(select)
      .eq("org_id", orgId)
      .eq("store_id", storeId)
      .eq("buyer_username", buyerUsername)
      .gte("created_on_ebay", since)
      .order("created_on_ebay", { ascending: false })
      .limit(1);
    row = (data?.[0] as unknown as Row) ?? null;
  }
  if (!row) return { order: null, listingTitle };
  return {
    listingTitle,
    order: {
      status: row.status.replaceAll("_", " "),
      orderedOn: row.created_on_ebay,
      shipBy: row.ship_by,
      items: (row.order_lines ?? []).map((l) => ({ title: l.listings?.title ?? "item", quantity: l.quantity })),
      tracking: (row.fulfillments ?? []).filter((f) => f.posted_at || f.tracking_number).map((f) => ({ carrier: f.carrier, number: f.tracking_number, postedAt: f.posted_at })),
    },
  };
}

export async function loadStorePolicies(orgId: string, storeId: string): Promise<{ handlingDays: number | null; returnPolicy: string | null }> {
  const db = createAdminClient();
  const { data: store } = await db.from("ebay_stores").select("id").eq("id", storeId).eq("org_id", orgId).maybeSingle();
  if (!store) return { handlingDays: null, returnPolicy: null };
  const { data: rules } = await db.from("store_rules").select("handling_days").eq("store_id", storeId).maybeSingle();
  let returnPolicy: string | null = null;
  try {
    const p = await getPolicies(await getEbayClient(storeId));
    if (p.return.length) returnPolicy = `eBay return policy on file: ${p.return.map((r) => r.name).join(", ")}`;
  } catch {
    // Best effort: the seller can add details in the notes field.
  }
  return { handlingDays: (rules?.handling_days as number | null) ?? null, returnPolicy };
}
