"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FormMessage, Select, TextInput, type ActionState } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import type { UploadFolder } from "@/lib/course/paths";

type ResourceKind = "file" | "pdf" | "spreadsheet" | "template" | "checklist" | "other";

type Ticket = { ok: true; path: string; signedUrl: string } | { ok: false; message: string };

type Props = {
  lessonId: string;
  folder: UploadFolder;
  createUploadUrl: (input: { lessonId: string; folder: UploadFolder; fileName: string; size: number }) => Promise<Ticket>;
  finishUpload: (input: {
    lessonId: string;
    folder: UploadFolder;
    path: string;
    title: string;
    kind?: ResourceKind;
    fileName: string;
    contentType: string;
    size: number;
  }) => Promise<ActionState>;
  label: string;
  accept?: string;
  buttonText: string;
};

const KIND_OPTIONS = [
  { value: "file", label: "File" },
  { value: "pdf", label: "PDF" },
  { value: "spreadsheet", label: "Spreadsheet" },
  { value: "template", label: "Template" },
  { value: "checklist", label: "Checklist" },
  { value: "other", label: "Other" },
];

/**
 * Uploads a file straight to the course-resources bucket with a one-time signed
 * upload URL, then records it (resource row, lesson video or captions).
 */
export function StorageUpload({ lessonId, folder, createUploadUrl, finishUpload, label, accept, buttonText }: Props) {
  const uid = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState("file");
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<ActionState>(null);
  const router = useRouter();

  async function upload() {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setState({ ok: false, message: "Choose a file first." });
      return;
    }
    setBusy(true);
    setState({ ok: true, message: `Uploading ${file.name}…` });
    try {
      const ticket = await createUploadUrl({ lessonId, folder, fileName: file.name, size: file.size });
      if (!ticket.ok) {
        setState({ ok: false, message: ticket.message });
        return;
      }
      const headers: Record<string, string> = {
        "content-type": file.type || "application/octet-stream",
        "x-upsert": "false",
      };
      const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (anon) headers.apikey = anon;
      const res = await fetch(ticket.signedUrl, { method: "PUT", headers, body: file });
      if (!res.ok) {
        setState({ ok: false, message: "The upload failed. Check your connection and try again." });
        return;
      }
      const result = await finishUpload({
        lessonId,
        folder,
        path: ticket.path,
        title: title.trim(),
        kind: folder === "resources" ? (kind as ResourceKind) : undefined,
        fileName: file.name,
        contentType: file.type,
        size: file.size,
      });
      setState(result);
      if (result?.ok) {
        if (fileRef.current) fileRef.current.value = "";
        setTitle("");
        router.refresh();
      }
    } catch {
      setState({ ok: false, message: "The upload failed. Try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3" aria-busy={busy}>
      <div>
        <label htmlFor={`${uid}-file`} className="mb-1 block text-sm font-medium">
          {label}
        </label>
        <input
          ref={fileRef}
          id={`${uid}-file`}
          type="file"
          accept={accept}
          disabled={busy}
          className="block w-full text-sm file:mr-3 file:min-h-10 file:rounded-md file:border file:border-ink/20 file:bg-card file:px-4 file:text-sm file:font-semibold"
        />
      </div>
      {folder === "resources" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <TextInput
            id={`${uid}-title`}
            label="Title"
            hint="Leave blank to use the file name."
            maxLength={200}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={busy}
          />
          <Select
            id={`${uid}-kind`}
            label="Type"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            options={KIND_OPTIONS}
            disabled={busy}
          />
        </div>
      )}
      <div aria-live="polite">
        <FormMessage state={state} />
      </div>
      <Button onClick={upload} disabled={busy} variant="secondary">
        {busy ? "Uploading…" : buttonText}
      </Button>
    </div>
  );
}
