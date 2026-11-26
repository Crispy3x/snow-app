import { requireStore } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { RECONNECT_MESSAGE, ebayErrorMessage, loadConversation, storeHasMessageScope, type LoadedConversation } from "@/lib/ai-tools/messages-data";
import { Alert, PageHeader, Panel, TextLink } from "@/components/ui/app";
import { LinkButton } from "@/components/ui/button";
import { AiCredits, DraftBadge } from "@/components/ai-tools/credits";
import { DraftPanel } from "./draft-panel";

export const metadata = { title: "Buyer conversation" };

export default async function ConversationPage({
  params,
  searchParams,
}: {
  params: Promise<{ conversationId: string }>;
  searchParams: Promise<{ ref?: string }>;
}) {
  const ctx = await requireStore();
  const conversationId = safeDecode((await params).conversationId).slice(0, 200);
  const ref = (await searchParams).ref;
  const referenceId = ref && /^[\w-]{1,64}$/.test(ref) ? ref : "";

  const scope = await storeHasMessageScope(ctx.org.id, ctx.store.id);
  let convo: LoadedConversation | null = null;
  let error: { reconnect: boolean; message: string } | null = null;
  if (scope.hasScope === false) error = { reconnect: true, message: RECONNECT_MESSAGE };
  else {
    try {
      convo = await loadConversation(ctx.store.id, conversationId, scope.username);
    } catch (e) {
      error = ebayErrorMessage(e);
    }
  }

  const db = createAdminClient();
  const { data: drafts } = await db
    .from("message_drafts")
    .select("id, draft, status, sent_at, created_at, ai_request_id")
    .eq("org_id", ctx.org.id)
    .eq("store_id", ctx.store.id)
    .eq("ebay_conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(10);
  const open = drafts?.find((d) => d.status === "draft") ?? null;
  const history = (drafts ?? []).filter((d) => d.id !== open?.id);

  return (
    <>
      <PageHeader
        title="Buyer conversation"
        description={<TextLink href="/app/ai/messages">Back to all conversations</TextLink>}
        actions={<AiCredits orgId={ctx.org.id} tool="buyer_message" perRunNote="Each draft uses 2." />}
      />
      {error ? (
        <Alert tone={error.reconnect ? "warning" : "danger"} title={error.reconnect ? "Reconnect your store" : "Couldn't load this conversation"}>
          <p>{error.message}</p>
          {error.reconnect && (
            <div className="mt-3">
              <LinkButton href="/app/stores" variant="secondary">Go to eBay stores</LinkButton>
            </div>
          )}
        </Alert>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <Panel title="Messages">
            {convo?.messages.length ? (
              <ol className="grid gap-3">
                {convo.messages.map((m, i) => (
                  <li key={i} className={`rounded-md border p-3 ${m.fromBuyer ? "border-line bg-card" : "border-accent/20 bg-accent-soft"}`}>
                    <p className="text-xs font-semibold text-ink-muted">
                      {m.fromBuyer ? "Buyer" : "You"} · {m.date ? new Date(m.date).toLocaleString("en-US") : ""}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap break-words text-sm">{m.text}</p>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-ink-muted">No messages in this conversation.</p>
            )}
          </Panel>
          <div className="grid content-start gap-6">
            <DraftPanel
              conversationId={conversationId}
              referenceId={referenceId}
              openDraft={open ? { id: open.id, text: open.draft, requestId: open.ai_request_id } : null}
            />
            {history.length > 0 && (
              <Panel title="Earlier drafts">
                <ul className="grid gap-3">
                  {history.map((d) => (
                    <li key={d.id} className="rounded-md border border-line p-3 text-sm">
                      <p className="flex items-center gap-2 text-xs text-ink-muted">
                        <DraftBadge status={d.status} />
                        {d.sent_at ? `Sent ${new Date(d.sent_at).toLocaleString("en-US")}` : new Date(d.created_at).toLocaleString("en-US")}
                      </p>
                      <p className="mt-1 whitespace-pre-wrap break-words">{d.draft}</p>
                    </li>
                  ))}
                </ul>
              </Panel>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function safeDecode(s: string) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
