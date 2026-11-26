import { after, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { inngest, EVENTS } from "@/lib/inngest/client";
import { getNotificationPublicKey } from "@/lib/ebay/store-api";
import {
  cachedKeyFetcher,
  challengeResponse,
  handleDeletionNotification,
  type DeletionNotification,
} from "@/lib/ebay/notifications";

/**
 * eBay Marketplace Account Deletion endpoint (mandatory). Register this URL and
 * EBAY_DELETION_VERIFICATION_TOKEN in the eBay developer portal (Alerts & Notifications).
 */

const getPublicKey = cachedKeyFetcher(async (kid) => {
  const k = await getNotificationPublicKey(kid);
  return { key: k.key, digest: k.digest };
});

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("challenge_code");
  const token = process.env.EBAY_DELETION_VERIFICATION_TOKEN;
  const endpoint = process.env.EBAY_DELETION_ENDPOINT_URL;
  if (!code) return Response.json({ error: "challenge_code is required" }, { status: 400 });
  if (!token || !endpoint) return Response.json({ error: "deletion endpoint is not configured" }, { status: 500 });
  return new Response(JSON.stringify({ challengeResponse: challengeResponse(code, token, endpoint) }), {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

async function record(n: DeletionNotification): Promise<"new" | "duplicate"> {
  const db = createAdminClient();
  const { data, error } = await db
    .from("ebay_notifications")
    .upsert(
      { id: n.notificationId, topic: n.topic, ebay_user_id: n.ebayUserId, payload: n.payload },
      { onConflict: "id", ignoreDuplicates: true },
    )
    .select("id");
  if (error) throw new Error(error.message);
  if (data && data.length > 0) return "new";
  // Already stored: re-enqueue only if processing never finished (e.g. Inngest was down).
  const { data: existing } = await db.from("ebay_notifications").select("processed_at").eq("id", n.notificationId).maybeSingle();
  return existing && !existing.processed_at ? "new" : "duplicate";
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const result = await handleDeletionNotification(raw, req.headers.get("x-ebay-signature"), { getPublicKey, record });

  if ("notification" in result && result.isNew) {
    const n = result.notification;
    after(async () => {
      try {
        await inngest.send({
          name: EVENTS.ebayAccountDeleted,
          data: { ebayUserId: n.ebayUserId, username: n.username, notificationId: n.notificationId },
        });
      } catch (e) {
        await createAdminClient()
          .from("ebay_notifications")
          .update({ error: `enqueue failed: ${e instanceof Error ? e.message : String(e)}` })
          .eq("id", n.notificationId);
      }
    });
  }

  if (result.status === 204) return new Response(null, { status: 204 });
  return Response.json({ error: result.error }, { status: result.status });
}
