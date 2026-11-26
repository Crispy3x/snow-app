"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStore } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { runAiWithTools, type LocalTool } from "@/lib/ai-tools/loop";
import { CHAT_TOOL_DEFS, chatSystemPrompt, runChatTool } from "@/lib/ai-tools/chat-tools";
import { isUuid, setAiDraftStatus } from "@/lib/ai-tools/drafts";

export type ChatMessage = { role: "user" | "assistant"; content: string; at: string; requestId?: string; status?: "draft" | "approved" };
export type ChatResult = { ok: boolean; message?: string; threadId?: string; messages?: ChatMessage[] };

const MAX_HISTORY = 20;

async function loadThread(orgId: string, userId: string, threadId: string) {
  const db = createAdminClient();
  const { data } = await db
    .from("chat_threads")
    .select("id, title, messages, store_id")
    .eq("id", threadId)
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .maybeSingle();
  return data as { id: string; title: string | null; messages: ChatMessage[]; store_id: string | null } | null;
}

export async function sendChatMessage(threadId: string | null, text: string): Promise<ChatResult> {
  const ctx = await requireStore();
  const question = String(text ?? "").trim();
  if (!question) return { ok: false, message: "Type a question first." };
  if (question.length > 2000) return { ok: false, message: "Keep questions under 2,000 characters." };

  const db = createAdminClient();
  let thread = null;
  if (threadId) {
    if (!isUuid(threadId)) return { ok: false, message: "Conversation not found." };
    thread = await loadThread(ctx.org.id, ctx.user.id, threadId);
    if (!thread) return { ok: false, message: "Conversation not found." };
  }
  const history = (thread?.messages ?? []).slice(-MAX_HISTORY);

  const { data: access } = await db.rpc("has_course_access", { p_user: ctx.user.id });
  const scope = { orgId: ctx.org.id, storeId: ctx.store.id, userId: ctx.user.id, hasCourseAccess: access === true };
  const tools: LocalTool[] = CHAT_TOOL_DEFS.map((definition) => ({
    definition,
    run: (input: unknown) => runChatTool(db, scope, definition.name, input),
  }));

  const res = await runAiWithTools({
    orgId: ctx.org.id,
    userId: ctx.user.id,
    storeId: ctx.store.id,
    tool: "store_chat",
    system: chatSystemPrompt({
      today: new Date().toISOString().slice(0, 10),
      storeLabel: ctx.store.label ?? ctx.store.ebay_username ?? "eBay store",
      marketplace: ctx.store.marketplace_id,
    }),
    messages: [...history.map((m) => ({ role: m.role, content: m.content })), { role: "user" as const, content: question }],
    tools,
  });
  if (!res.ok) return { ok: false, message: res.message, threadId: thread?.id };

  const now = new Date().toISOString();
  const messages: ChatMessage[] = [
    ...(thread?.messages ?? []),
    { role: "user", content: question, at: now },
    { role: "assistant", content: res.output || "I couldn't find an answer to that.", at: now, requestId: res.requestId, status: "draft" },
  ];

  if (thread) {
    await db.from("chat_threads").update({ messages, store_id: ctx.store.id }).eq("id", thread.id).eq("org_id", ctx.org.id).eq("user_id", ctx.user.id);
  } else {
    const { data, error } = await db
      .from("chat_threads")
      .insert({ org_id: ctx.org.id, user_id: ctx.user.id, store_id: ctx.store.id, title: question.slice(0, 80), messages })
      .select("id")
      .single();
    if (error || !data) return { ok: false, message: "The answer couldn't be saved. Please try again." };
    thread = { id: data.id as string, title: question.slice(0, 80), messages, store_id: ctx.store.id };
  }
  revalidatePath("/app/ai/chat");
  return { ok: true, threadId: thread.id, messages };
}

/** Keep (approved) or discard (rejected, removed from the thread) an assistant answer. */
export async function decideAnswer(threadId: string, requestId: string, decision: "approved" | "rejected"): Promise<ChatResult> {
  const ctx = await requireStore();
  if (!isUuid(threadId) || !isUuid(requestId)) return { ok: false, message: "Answer not found." };
  const thread = await loadThread(ctx.org.id, ctx.user.id, threadId);
  if (!thread) return { ok: false, message: "Conversation not found." };
  const idx = thread.messages.findIndex((m) => m.role === "assistant" && m.requestId === requestId);
  if (idx < 0) return { ok: false, message: "Answer not found." };

  let messages: ChatMessage[];
  if (decision === "rejected") {
    // Drop the answer and the question it answered so the thread stays question/answer pairs.
    const start = idx > 0 && thread.messages[idx - 1].role === "user" ? idx - 1 : idx;
    messages = [...thread.messages.slice(0, start), ...thread.messages.slice(idx + 1)];
  } else {
    messages = thread.messages.map((m, i) => (i === idx ? { ...m, status: "approved" as const } : m));
  }
  const db = createAdminClient();
  await db.from("chat_threads").update({ messages }).eq("id", threadId).eq("org_id", ctx.org.id).eq("user_id", ctx.user.id);
  await setAiDraftStatus(ctx.org.id, requestId, decision);
  revalidatePath("/app/ai/chat");
  return { ok: true, threadId, messages };
}

export async function deleteThread(formData: FormData) {
  const ctx = await requireStore();
  const id = formData.get("threadId");
  if (isUuid(id)) {
    await createAdminClient().from("chat_threads").delete().eq("id", id).eq("org_id", ctx.org.id).eq("user_id", ctx.user.id);
  }
  revalidatePath("/app/ai/chat");
  redirect("/app/ai/chat");
}
