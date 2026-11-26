import Link from "next/link";
import { requireStore } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { isUuid } from "@/lib/ai-tools/drafts";
import { PageHeader, Panel } from "@/components/ui/app";
import { LinkButton } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";
import { AiCredits } from "@/components/ai-tools/credits";
import { ChatClient } from "./chat-client";
import { deleteThread, type ChatMessage } from "./actions";

export const metadata = { title: "Store assistant" };
export const maxDuration = 120;

export default async function ChatPage({ searchParams }: { searchParams: Promise<{ thread?: string }> }) {
  const ctx = await requireStore();
  const { thread: threadId } = await searchParams;
  const db = createAdminClient();
  const { data: threads } = await db
    .from("chat_threads")
    .select("id, title, created_at")
    .eq("org_id", ctx.org.id)
    .eq("user_id", ctx.user.id)
    .order("created_at", { ascending: false })
    .limit(30);

  type Thread = { id: string; title: string | null; messages: ChatMessage[] };
  let current: Thread | null = null;
  if (isUuid(threadId)) {
    const { data } = await db
      .from("chat_threads")
      .select("id, title, messages")
      .eq("id", threadId)
      .eq("org_id", ctx.org.id)
      .eq("user_id", ctx.user.id)
      .maybeSingle();
    current = data as Thread | null;
  }

  return (
    <>
      <PageHeader
        title="Store assistant"
        description="Ask about your listings, orders, margins, rules and the course. It only reads this store's data and can't change anything."
        actions={<AiCredits orgId={ctx.org.id} tool="store_chat" perRunNote="Each answer uses 3." />}
      />
      <div className="grid gap-6 lg:grid-cols-[16rem_1fr]">
        <Panel title="Conversations" actions={<LinkButton href="/app/ai/chat" variant="secondary">New chat</LinkButton>}>
          {threads?.length ? (
            <ul className="grid gap-1">
              {threads.map((t) => (
                <li key={t.id} className="flex items-center gap-1">
                  <Link
                    href={`/app/ai/chat?thread=${t.id}`}
                    aria-current={t.id === current?.id ? "page" : undefined}
                    className={`min-w-0 flex-1 truncate rounded-md px-2 py-2 text-sm hover:bg-ink/5 ${t.id === current?.id ? "bg-accent-soft font-semibold" : ""}`}
                  >
                    {t.title || "Untitled"}
                  </Link>
                  <form action={deleteThread}>
                    <input type="hidden" name="threadId" value={t.id} />
                    <SubmitButton variant="ghost" className="px-2" pendingText="…" aria-label={`Delete conversation: ${t.title || "Untitled"}`}>
                      Delete
                    </SubmitButton>
                  </form>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-muted">No conversations yet.</p>
          )}
        </Panel>
        <ChatClient key={current?.id ?? "new"} threadId={current?.id ?? null} initialMessages={current?.messages ?? []} />
      </div>
    </>
  );
}
