import Link from "next/link";
import { requireStore } from "@/lib/auth";
import { getEbayClient } from "@/lib/ebay/client";
import { getConversations } from "@/lib/ebay/api";
import { createAdminClient } from "@/lib/supabase/admin";
import { RECONNECT_MESSAGE, ebayErrorMessage, storeHasMessageScope } from "@/lib/ai-tools/messages-data";
import { Alert, EmptyState, PageHeader, Panel } from "@/components/ui/app";
import { Badge } from "@/components/ui/layout";
import { LinkButton } from "@/components/ui/button";
import { AiCredits } from "@/components/ai-tools/credits";

export const metadata = { title: "Buyer messages" };

type Conversation = NonNullable<Awaited<ReturnType<typeof getConversations>>["conversations"]>[number];

export default async function MessagesPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const ctx = await requireStore();
  const page = Math.max(0, Math.min(40, Number((await searchParams).page) || 0));
  const scope = await storeHasMessageScope(ctx.org.id, ctx.store.id);

  let conversations: Conversation[] = [];
  let error: { reconnect: boolean; message: string } | null = null;
  if (scope.hasScope === false) {
    error = { reconnect: true, message: RECONNECT_MESSAGE };
  } else {
    try {
      const res = await getConversations(await getEbayClient(ctx.store.id), page * 25);
      conversations = res.conversations ?? [];
    } catch (e) {
      error = ebayErrorMessage(e);
    }
  }

  const db = createAdminClient();
  const { data: drafts } = await db
    .from("message_drafts")
    .select("ebay_conversation_id, status")
    .eq("org_id", ctx.org.id)
    .eq("store_id", ctx.store.id)
    .eq("status", "draft")
    .in("ebay_conversation_id", conversations.map((c) => c.conversationId).slice(0, 100));
  const withDraft = new Set((drafts ?? []).map((d) => d.ebay_conversation_id as string));

  return (
    <>
      <PageHeader
        title="Buyer messages"
        description="Draft replies to buyers with AI. You review and edit every reply, and nothing is sent until you approve it."
        actions={<AiCredits orgId={ctx.org.id} tool="buyer_message" perRunNote="Each draft uses 2." />}
      />

      {error ? (
        <Alert tone={error.reconnect ? "warning" : "danger"} title={error.reconnect ? "Reconnect your store" : "Couldn't load messages"}>
          <p>{error.message}</p>
          {error.reconnect && (
            <div className="mt-3">
              <LinkButton href="/app/stores" variant="secondary">Go to eBay stores</LinkButton>
            </div>
          )}
        </Alert>
      ) : conversations.length === 0 ? (
        <EmptyState title="No buyer conversations">{page ? "No more conversations." : "Messages from buyers will show up here."}</EmptyState>
      ) : (
        <Panel title="Recent conversations" description={`Store: ${ctx.store.label ?? ctx.store.ebay_username ?? "eBay store"}`}>
          <ul className="divide-y divide-line">
            {conversations.map((c) => {
              const ref = c.referenceId && /^[\w-]{1,64}$/.test(c.referenceId) ? c.referenceId : "";
              return (
                <li key={c.conversationId}>
                  <Link
                    href={`/app/ai/messages/${encodeURIComponent(c.conversationId)}${ref ? `?ref=${ref}` : ""}`}
                    className="flex flex-col gap-1 px-1 py-3 hover:bg-ink/5 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{c.conversationTitle || c.latestMessage?.senderUsername || "Conversation"}</span>
                      <span className="block truncate text-sm text-ink-muted">{c.latestMessage?.messageBody ?? ""}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2 text-sm text-ink-muted">
                      {withDraft.has(c.conversationId) && <Badge tone="amber">Draft waiting</Badge>}
                      {(c.unreadCount ?? 0) > 0 && <Badge tone="accent">{c.unreadCount} unread</Badge>}
                      {c.latestMessage?.createdDate && new Date(c.latestMessage.createdDate).toLocaleDateString("en-US")}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
          <nav aria-label="Pages" className="mt-4 flex justify-between gap-2">
            {page > 0 ? <LinkButton variant="secondary" href={`/app/ai/messages?page=${page - 1}`}>Newer</LinkButton> : <span />}
            {conversations.length === 25 && <LinkButton variant="secondary" href={`/app/ai/messages?page=${page + 1}`}>Older</LinkButton>}
          </nav>
        </Panel>
      )}
    </>
  );
}
