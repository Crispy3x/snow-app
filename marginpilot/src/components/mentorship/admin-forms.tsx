"use client";

import { useActionState, useId, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { FormMessage, Select, TextArea, TextInput, type ActionState } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";
import { isoToLocalDateTime } from "@/lib/mentorship/validation";
import {
  addResourceLink,
  createResourceUploadUrl,
  finishResourceUpload,
  saveFeedback,
  saveSession,
} from "@/app/(admin)/admin/mentorship/actions";

const noop = () => () => {};
/** The admin browser's UTC offset (minutes, as Date.getTimezoneOffset), or null during SSR. */
function useTzOffset(): number | null {
  return useSyncExternalStore(noop, () => new Date().getTimezoneOffset(), () => null);
}

export type SessionValues = {
  id: string;
  title: string;
  description: string | null;
  starts_at: string;
  duration_min: number;
  join_url: string | null;
  recording_url: string | null;
  status: "scheduled" | "done" | "cancelled";
};

/** Create or edit a session. Times are entered in the admin's local time zone and stored as UTC. */
export function SessionForm({ session }: { session?: SessionValues }) {
  const [state, action] = useActionState<ActionState, FormData>(saveSession, null);
  const offset = useTzOffset();
  const fe = state?.fieldErrors ?? {};
  const p = session ? `s-${session.id}` : "new-session";
  const tzName = offset === null ? "" : Intl.DateTimeFormat().resolvedOptions().timeZone;
  return (
    <form action={action} className="grid gap-4" key={offset === null ? "ssr" : "client"}>
      {session && <input type="hidden" name="id" value={session.id} />}
      <input type="hidden" name="tz_offset" value={offset ?? 0} />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextInput id={`${p}-title`} name="title" label="Title" required maxLength={200} defaultValue={session?.title} error={fe.title} />
        <TextInput
          id={`${p}-starts`}
          name="starts_local"
          type="datetime-local"
          label={`Starts${tzName ? ` (${tzName})` : ""}`}
          required
          defaultValue={session && offset !== null ? isoToLocalDateTime(session.starts_at, offset) : ""}
          error={fe.starts_local}
        />
        <TextInput
          id={`${p}-duration`}
          name="duration_min"
          label="Length (minutes)"
          inputMode="numeric"
          defaultValue={session?.duration_min ?? 60}
          error={fe.duration_min}
        />
        <Select
          id={`${p}-status`}
          name="status"
          label="Status"
          defaultValue={session?.status ?? "scheduled"}
          options={[
            { value: "scheduled", label: "Scheduled" },
            { value: "done", label: "Done" },
            { value: "cancelled", label: "Cancelled" },
          ]}
        />
        <TextInput
          id={`${p}-join`}
          name="join_url"
          label="Join link"
          inputMode="url"
          defaultValue={session?.join_url ?? ""}
          error={fe.join_url}
          hint="Zoom, Meet or similar. Shown to Mentorship members."
        />
        <TextInput
          id={`${p}-recording`}
          name="recording_url"
          label="Recording link"
          inputMode="url"
          defaultValue={session?.recording_url ?? ""}
          error={fe.recording_url}
          hint="Add after the call. Use an unlisted or access-controlled link."
        />
      </div>
      <TextArea id={`${p}-description`} name="description" label="Description" rows={3} maxLength={4000} defaultValue={session?.description ?? ""} error={fe.description} />
      <FormMessage state={state} />
      <div>
        <SubmitButton pendingText="Saving…" disabled={offset === null}>
          {session ? "Save session" : "Schedule session"}
        </SubmitButton>
      </div>
    </form>
  );
}

export function ResourceLinkForm() {
  const [state, action] = useActionState<ActionState, FormData>(addResourceLink, null);
  const fe = state?.fieldErrors ?? {};
  return (
    <form action={action} className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <TextInput id="res-title" name="title" label="Title" required maxLength={200} error={fe.title} />
        <TextInput id="res-url" name="url" label="Link" inputMode="url" required error={fe.url} hint="https://…" />
      </div>
      <TextArea id="res-description" name="description" label="Description (optional)" rows={2} maxLength={2000} error={fe.description} />
      <FormMessage state={state} />
      <div>
        <SubmitButton variant="secondary" pendingText="Adding…">Add link</SubmitButton>
      </div>
    </form>
  );
}

/** Uploads straight to the private bucket with a one-time signed URL, then records the resource. */
export function ResourceUpload() {
  const uid = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<ActionState>(null);
  const router = useRouter();

  async function upload() {
    const file = fileRef.current?.files?.[0];
    if (!file) return setState({ ok: false, message: "Choose a file first." });
    setBusy(true);
    setState({ ok: true, message: `Uploading ${file.name}…` });
    try {
      const ticket = await createResourceUploadUrl({ fileName: file.name, size: file.size });
      if (!ticket.ok) return setState({ ok: false, message: ticket.message });
      const headers: Record<string, string> = { "content-type": file.type || "application/octet-stream", "x-upsert": "false" };
      const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (anon) headers.apikey = anon;
      const res = await fetch(ticket.signedUrl, { method: "PUT", headers, body: file });
      if (!res.ok) return setState({ ok: false, message: "The upload failed. Check your connection and try again." });
      const result = await finishResourceUpload({ path: ticket.path, title: title.trim(), description: description.trim(), fileName: file.name });
      setState(result);
      if (result?.ok) {
        if (fileRef.current) fileRef.current.value = "";
        setTitle("");
        setDescription("");
        router.refresh();
      }
    } catch {
      setState({ ok: false, message: "The upload failed. Try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4" aria-busy={busy}>
      <div>
        <label htmlFor={`${uid}-file`} className="mb-1 block text-sm font-medium">
          File (max 50 MB)
        </label>
        <input
          ref={fileRef}
          id={`${uid}-file`}
          type="file"
          disabled={busy}
          className="block w-full text-sm file:mr-3 file:min-h-10 file:rounded-md file:border file:border-ink/20 file:bg-card file:px-4 file:text-sm file:font-semibold"
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextInput id={`${uid}-title`} label="Title" hint="Defaults to the file name." value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
        <TextInput id={`${uid}-description`} label="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} />
      </div>
      <FormMessage state={state} />
      <div>
        <Button variant="secondary" onClick={upload} disabled={busy}>
          {busy ? "Uploading…" : "Upload file"}
        </Button>
      </div>
    </div>
  );
}

export function FeedbackForm({ id, draft, delivered }: { id: string; draft: string; delivered: boolean }) {
  const [state, action] = useActionState<ActionState, FormData>(saveFeedback, null);
  return (
    <form action={action} className="grid gap-4">
      <input type="hidden" name="id" value={id} />
      <TextArea
        id="feedback"
        label="Written feedback"
        hint="Plain text; line breaks are kept. Save a draft as you go. Only delivered feedback is visible to the workspace."
        rows={16}
        maxLength={20000}
        defaultValue={draft}
        error={state?.fieldErrors?.feedback}
      />
      <FormMessage state={state} />
      <div className="flex flex-wrap gap-2">
        <SubmitButton name="intent" value="save" variant="secondary" pendingText="Saving…">
          Save draft
        </SubmitButton>
        <SubmitButton name="intent" value="deliver" pendingText="Delivering…">
          {delivered ? "Deliver updated feedback" : "Deliver feedback"}
        </SubmitButton>
      </div>
    </form>
  );
}
