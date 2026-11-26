"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStore } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { runAi } from "@/lib/ai/run";
import { getEbayClient } from "@/lib/ebay/client";
import { sendMessage } from "@/lib/ebay/api";
import { logActivity } from "@/lib/activity";
import { isUuid, setAiDraftStatus } from "@/lib/ai-tools/drafts";
import { TONES, buildBuyerMessagePrompt, cleanBuyerText, type Tone } from "@/lib/ai-tools/messages";
import { RECONNECT_MESSAGE, ebayErrorMessage, findOrderContext, loadConversation, loadStorePolicies, storeHasMessageScope } from "@/lib/ai-tools/messages-data";

export type DraftState = {
  ok?: boolean;
  message?: string;
  reconnect?: boolean;
  draft?: { id: string; text: string; requestId: string | null };
} | null;

const DraftInput = z.object({
  conversationId: z.string().min(1).max(200),
  referenceId: z.string().regex(/^[\w-]{0,64}$/).optional().default(""),
  tone: z.enum(Object.keys(TONES) as [Tone, ...Tone[]]),
  notes: z.string().max(1000).optional().default(""),
});

export async function draftReply(_prev: DraftState, formData: FormData): Promise<DraftState> {
  const ctx = await requireStore();
  const parsed = DraftInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: "Choose a tone and try again." };
  const input = parsed.data;

  const scope = await storeHasMessageScope(ctx.org.id, ctx.store.id);
  if (scope.hasScope === false) return { ok: false, reconnect: true, message: RECONNECT_MESSAGE };

  let convo;
  try {
    convo = await loadConversation(ctx.store.id, input.conversationId, scope.username);
  } catch (e) {
    const m = ebayErrorMessage(e);
    return { ok: false, reconnect: m.reconnect, message: m.message };
  }
  const lastBuyer = [...convo.messages].reverse().find((m) => m.fromBuyer);
  if (!lastBuyer) return { ok: false, message: "There's no buyer message to reply to in this conversation." };

  const [{ order, listingTitle }, policies] = await Promise.all([
    findOrderContext(ctx.org.id, ctx.store.id, input.referenceId || null, convo.buyerUsername),
    loadStorePolicies(ctx.org.id, ctx.store.id),
  ]);

  const prompt = buildBuyerMessagePrompt({
    messages: convo.messages,
    buyerUsername: convo.buyerUsername,
    tone: input.tone,
    order,
    listingTitle,
    handlingDays: policies.handlingDays,
    returnPolicy: policies.returnPolicy,
    sellerNotes: input.notes || null,
  });

  const res = await runAi({
    orgId: ctx.org.id,
    userId: ctx.user.id,
    storeId: ctx.store.id,
    tool: "buyer_message",
    system: prompt.system,
    messages: [{ role: "user", content: prompt.user }],
    maxTokens: 1000,
    effort: "low",
  });
  if (!res.ok) return { ok: false, message: res.message };

  const db = createAdminClient();
  const { data, error } = await db
    .from("message_drafts")
    .insert({
      org_id: ctx.org.id,
      store_id: ctx.store.id,
      ebay_conversation_id: input.conversationId,
      buyer_message: cleanBuyerText(lastBuyer.text, convo.buyerUsername), // stored redacted
      draft: res.text.trim(),
      status: "draft",
      ai_request_id: res.requestId || null,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, message: "The draft was written but couldn't be saved. Please try again." };
  revalidatePath(`/app/ai/messages/${encodeURIComponent(input.conversationId)}`);
  return { ok: true, message: "Draft ready. Review and edit it before sending.", draft: { id: data.id, text: res.text.trim(), requestId: res.requestId || null } };
}

export type SendState = { ok?: boolean; message?: string; reconnect?: boolean; sent?: boolean; discarded?: boolean } | null;

const SendInput = z.object({
  draftId: z.string().refine(isUuid),
  text: z.string().trim().min(1, "The reply is empty").max(2000, "eBay messages can be up to 2,000 characters"),
  confirm: z.literal("yes", { message: "Tick the box to confirm you've reviewed this reply" }),
});

/** Sends one reviewed reply. Only ever called from the seller's explicit "Approve and send" click. */
export async function approveAndSend(_prev: SendState, formData: FormData): Promise<SendState> {
  const ctx = await requireStore();
  const parsed = SendInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the reply." };
  const { draftId, text } = parsed.data;

  const db = createAdminClient();
  const { data: draft } = await db
    .from("message_drafts")
    .select("id, ebay_conversation_id, status, ai_request_id, draft")
    .eq("id", draftId)
    .eq("org_id", ctx.org.id)
    .eq("store_id", ctx.store.id)
    .maybeSingle();
  if (!draft) return { ok: false, message: "Draft not found in this store." };
  if (draft.status !== "draft") return { ok: false, message: "This draft was already sent or discarded." };

  // Claim the draft first so a double click can't send twice.
  const { data: claimed } = await db
    .from("message_drafts")
    .update({ status: "approved", approved_by: ctx.user.id, draft: text })
    .eq("id", draftId)
    .eq("org_id", ctx.org.id)
    .eq("status", "draft")
    .select("id");
  if (!claimed?.length) return { ok: false, message: "This draft was already sent or discarded." };

  try {
    await sendMessage(await getEbayClient(ctx.store.id), draft.ebay_conversation_id, text);
  } catch (e) {
    await db.from("message_drafts").update({ status: "draft", approved_by: null }).eq("id", draftId).eq("org_id", ctx.org.id);
    const m = ebayErrorMessage(e);
    return { ok: false, reconnect: m.reconnect, message: `Not sent. ${m.message}` };
  }

  await db.from("message_drafts").update({ status: "applied", sent_at: new Date().toISOString() }).eq("id", draftId).eq("org_id", ctx.org.id);
  await setAiDraftStatus(ctx.org.id, draft.ai_request_id, "applied");
  await logActivity({
    orgId: ctx.org.id,
    storeId: ctx.store.id,
    actor: "user",
    userId: ctx.user.id,
    entityType: "message",
    entityId: draft.ebay_conversation_id,
    action: "buyer_reply_sent",
    after: { draftId, edited: text !== draft.draft },
  });
  revalidatePath(`/app/ai/messages/${encodeURIComponent(draft.ebay_conversation_id)}`);
  return { ok: true, sent: true, message: "Reply sent to the buyer on eBay." };
}

export async function discardDraft(_prev: SendState, formData: FormData): Promise<SendState> {
  const ctx = await requireStore();
  const draftId = formData.get("draftId");
  if (!isUuid(draftId)) return { ok: false, message: "Missing draft." };
  const db = createAdminClient();
  const { data } = await db
    .from("message_drafts")
    .update({ status: "rejected" })
    .eq("id", draftId)
    .eq("org_id", ctx.org.id)
    .eq("store_id", ctx.store.id)
    .eq("status", "draft")
    .select("ai_request_id, ebay_conversation_id")
    .maybeSingle();
  if (!data) return { ok: false, message: "This draft was already sent or discarded." };
  await setAiDraftStatus(ctx.org.id, data.ai_request_id, "rejected");
  revalidatePath(`/app/ai/messages/${encodeURIComponent(data.ebay_conversation_id)}`);
  return { ok: true, discarded: true, message: "Draft discarded." };
}
