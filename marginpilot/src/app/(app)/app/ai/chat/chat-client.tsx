"use client";

import { Fragment, useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Panel } from "@/components/ui/app";
import { Button } from "@/components/ui/button";
import { TextArea } from "@/components/ui/form";
import { decideAnswer, sendChatMessage, type ChatMessage } from "./actions";

const EXAMPLES = ["Which listings are under 25% margin?", "How did sales go in the last 30 days?", "Which active listings have zero views?", "What are my store's fee and margin rules?"];

/** Renders plain text with markdown links, allowing only in-app links (/app/...). */
function renderText(text: string): ReactNode {
  const parts: ReactNode[] = [];
  const re = /\[([^\]]{1,200})\]\((\/app\/[^\s)]{0,200})\)|\*\*([^*]{1,200})\*\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(<Fragment key={k++}>{text.slice(last, m.index)}</Fragment>);
    if (m[1]) {
      parts.push(
        <Link key={k++} href={m[2]} className="font-medium text-accent underline underline-offset-2 hover:text-accent-strong">
          {m[1]}
        </Link>,
      );
    } else parts.push(<strong key={k++}>{m[3]}</strong>);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(<Fragment key={k++}>{text.slice(last)}</Fragment>);
  return parts;
}

export function ChatClient({ threadId, initialMessages }: { threadId: string | null; initialMessages: ChatMessage[] }) {
  const router = useRouter();
  const [messages, setMessages] = useState(initialMessages);
  const [currentThread, setCurrentThread] = useState(threadId);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, pendingQuestion]);

  function ask(question: string) {
    const q = question.trim();
    if (!q || isPending) return;
    setError(null);
    setPendingQuestion(q);
    startTransition(async () => {
      const res = await sendChatMessage(currentThread, q);
      setPendingQuestion(null);
      if (!res.ok) {
        setError(res.message ?? "Something went wrong.");
        return;
      }
      setInput("");
      setMessages(res.messages ?? []);
      if (res.threadId && res.threadId !== currentThread) {
        setCurrentThread(res.threadId);
        router.replace(`/app/ai/chat?thread=${res.threadId}`, { scroll: false });
      }
    });
  }

  function decide(requestId: string, decision: "approved" | "rejected") {
    if (!currentThread) return;
    startTransition(async () => {
      const res = await decideAnswer(currentThread, requestId, decision);
      if (!res.ok) setError(res.message ?? "Couldn't update that answer.");
      else setMessages(res.messages ?? []);
    });
  }

  return (
    <Panel className="min-w-0">
      <div className="grid gap-4">
        <div className="grid max-h-[60vh] gap-3 overflow-y-auto" aria-live="polite" aria-busy={isPending}>
          {messages.length === 0 && !pendingQuestion && (
            <div className="grid gap-2">
              <p className="text-sm text-ink-muted">Try asking:</p>
              <div className="flex flex-wrap gap-2">
                {EXAMPLES.map((e) => (
                  <Button key={e} variant="secondary" onClick={() => ask(e)} disabled={isPending}>
                    {e}
                  </Button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`rounded-md border p-3 ${m.role === "user" ? "border-accent/20 bg-accent-soft sm:ml-12" : "border-line bg-card sm:mr-12"}`}>
              <p className="text-xs font-semibold text-ink-muted">{m.role === "user" ? "You" : "Assistant (AI draft)"}</p>
              <div className="mt-1 whitespace-pre-wrap break-words text-sm">{m.role === "assistant" ? renderText(m.content) : m.content}</div>
              {m.role === "assistant" && m.requestId && (
                <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                  {m.status === "approved" ? (
                    <span className="text-ink-muted">Kept</span>
                  ) : (
                    <>
                      <Button variant="secondary" onClick={() => decide(m.requestId!, "approved")} disabled={isPending}>
                        Keep answer
                      </Button>
                      <Button variant="ghost" onClick={() => decide(m.requestId!, "rejected")} disabled={isPending}>
                        Discard
                      </Button>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
          {pendingQuestion && (
            <>
              <div className="rounded-md border border-accent/20 bg-accent-soft p-3 sm:ml-12">
                <p className="text-xs font-semibold text-ink-muted">You</p>
                <p className="mt-1 whitespace-pre-wrap break-words text-sm">{pendingQuestion}</p>
              </div>
              <p className="text-sm text-ink-muted" role="status">
                Looking that up in your store data…
              </p>
            </>
          )}
          <div ref={endRef} />
        </div>

        {error && (
          <p role="alert" className="rounded-md border border-danger/30 bg-red-50 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}

        <form
          className="grid gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            ask(input);
          }}
        >
          <TextArea
            id="question"
            label="Your question"
            rows={3}
            maxLength={2000}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                ask(input);
              }
            }}
            hint="Enter to send, Shift+Enter for a new line."
          />
          <div>
            <Button type="submit" disabled={isPending || !input.trim()}>
              {isPending ? "Thinking…" : "Send"}
            </Button>
          </div>
        </form>
      </div>
    </Panel>
  );
}
