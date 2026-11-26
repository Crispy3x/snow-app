"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { Checkbox, FormMessage, Select, TextArea } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import { Panel } from "@/components/ui/app";
import { buttonClasses } from "@/components/ui/button";
import { approveAndSend, discardDraft, draftReply, type DraftState, type SendState } from "../actions";

const TONE_OPTIONS = [
  { value: "friendly", label: "Friendly" },
  { value: "professional", label: "Professional" },
  { value: "apologetic", label: "Apologetic" },
  { value: "firm", label: "Firm (stick to policy)" },
];

type OpenDraft = { id: string; text: string; requestId: string | null };

export function DraftPanel({ conversationId, referenceId, openDraft }: { conversationId: string; referenceId: string; openDraft: OpenDraft | null }) {
  const [draftState, draft] = useActionState<DraftState, FormData>(draftReply, null);
  const current = draftState?.draft ?? openDraft;

  return (
    <>
      <Panel title="Draft a reply" description="The buyer's contact details are removed before anything is sent to the AI.">
        <form action={draft} className="grid gap-4">
          <input type="hidden" name="conversationId" value={conversationId} />
          <input type="hidden" name="referenceId" value={referenceId} />
          <Select id="tone" label="Tone" defaultValue="friendly" options={TONE_OPTIONS} />
          <TextArea id="notes" label="Notes for the AI (optional)" rows={2} maxLength={1000} hint="e.g. offer a replacement, or the item ships Monday" />
          <FormMessage state={draftState} />
          {draftState?.reconnect && (
            <Link href="/app/stores" className={buttonClasses("secondary")}>
              Reconnect your store
            </Link>
          )}
          <div>
            <SubmitButton pendingText="Drafting…" variant={current ? "secondary" : "primary"}>
              {current ? "Write a new draft" : "Draft reply"}
            </SubmitButton>
          </div>
        </form>
      </Panel>
      {current && <ReviewDraft key={current.id} draft={current} />}
    </>
  );
}

function ReviewDraft({ draft }: { draft: OpenDraft }) {
  const [text, setText] = useState(draft.text);
  const [sendState, send] = useActionState<SendState, FormData>(approveAndSend, null);
  const [discardState, discard] = useActionState<SendState, FormData>(discardDraft, null);
  const done = sendState?.sent || discardState?.discarded;

  return (
    <Panel title="Review and send" description="AI draft. Edit it as needed. It is only sent when you approve it.">
      {done ? (
        <FormMessage state={sendState?.sent ? sendState : discardState} />
      ) : (
        <div className="grid gap-4">
          <form action={send} className="grid gap-4">
            <input type="hidden" name="draftId" value={draft.id} />
            <TextArea id={`text-${draft.id}`} name="text" label="Reply" rows={8} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} hint={`${text.length} / 2000 characters`} />
            <Checkbox id={`confirm-${draft.id}`} name="confirm" value="yes" required label="I've reviewed this reply and want to send it to the buyer on eBay." />
            <FormMessage state={sendState} />
            {sendState?.reconnect && (
              <Link href="/app/stores" className={buttonClasses("secondary")}>
                Reconnect your store
              </Link>
            )}
            <div>
              <SubmitButton pendingText="Sending…">Approve and send</SubmitButton>
            </div>
          </form>
          <form action={discard}>
            <input type="hidden" name="draftId" value={draft.id} />
            <FormMessage state={discardState} />
            <SubmitButton variant="ghost" pendingText="Discarding…">Discard draft</SubmitButton>
          </form>
        </div>
      )}
    </Panel>
  );
}
