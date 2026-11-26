"use client";

import { startTransition, useActionState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import { FormMessage, TextInput, type ActionState } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { createScreenshot, startScreenshotUpload } from "./actions";

const TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_BYTES = 15 * 1024 * 1024;

/**
 * Upload a Seller Hub screenshot. The file goes straight from the browser to
 * the private proof-originals bucket with a one-time signed upload URL; the
 * server then checks it's a real image and records it as pending.
 */
export function UploadScreenshotForm({ today }: { today: string }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<ActionState & { id?: string }, FormData>(async (prev, fd) => {
    const file = fd.get("image");
    if (!(file instanceof File) || file.size === 0) {
      return { ok: false, message: "Choose an image.", fieldErrors: { image: "Choose an image." } };
    }
    if (!TYPES.includes(file.type)) return { ok: false, message: "Use a PNG, JPEG or WebP image.", fieldErrors: { image: "Use a PNG, JPEG or WebP image." } };
    if (file.size > MAX_BYTES) return { ok: false, message: "The image must be under 15 MB.", fieldErrors: { image: "The image must be under 15 MB." } };

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anon) return { ok: false, message: "Storage isn't configured." };

    const start = await startScreenshotUpload({ type: file.type, size: file.size });
    if (!start.ok) return { ok: false, message: start.message };

    const storage = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } }).storage;
    const { error } = await storage.from("proof-originals").uploadToSignedUrl(start.path, start.token, file, { contentType: file.type });
    if (error) return { ok: false, message: `Upload failed: ${error.message}` };

    fd.delete("image");
    fd.set("path", start.path);
    const result = await createScreenshot(prev, fd);
    if (result?.ok && result.id) router.push(`/admin/proof/screenshots/${result.id}`);
    return result;
  }, null);

  const fe = state?.fieldErrors ?? {};
  return (
    <form
      // onSubmit (not action=) so the fields keep their values when there's an error.
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        startTransition(() => formAction(fd));
      }}
      className="space-y-4"
    >
      <div>
        <label htmlFor="shot-image" className="mb-1 block text-sm font-medium">
          Screenshot image
        </label>
        <input
          id="shot-image"
          name="image"
          type="file"
          required
          accept="image/png,image/jpeg,image/webp"
          aria-describedby={fe.image ? "shot-image-error" : "shot-image-hint"}
          aria-invalid={fe.image ? true : undefined}
          className="block w-full text-sm file:mr-3 file:min-h-10 file:rounded-md file:border file:border-ink/20 file:bg-card file:px-3 file:font-semibold file:text-ink"
        />
        {fe.image ? (
          <p id="shot-image-error" className="mt-1 text-sm font-medium text-danger">{fe.image}</p>
        ) : (
          <p id="shot-image-hint" className="mt-1 text-sm text-ink-muted">PNG, JPEG or WebP, up to 15 MB. Stored privately until you redact and approve it.</p>
        )}
      </div>
      <TextInput id="shot-caption" name="caption" label="Caption" required maxLength={200} hint="What it shows, e.g. Sales for October." error={fe.caption} />
      <TextInput id="shot-store" name="store_label" label="Store label" required maxLength={80} hint="How the store is described publicly, e.g. Home goods store." error={fe.store_label} />
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-1 text-sm font-medium">Date range shown in the screenshot</legend>
        <TextInput id="shot-start" name="range_start" type="date" label="From" required max={today} error={fe.range_start} />
        <TextInput id="shot-end" name="range_end" type="date" label="To" required max={today} error={fe.range_end} />
      </fieldset>
      <TextInput id="shot-captured" name="captured_on" type="date" label="Date captured" required max={today} defaultValue={today} error={fe.captured_on} />
      <FormMessage state={state} />
      <Button type="submit" disabled={pending} aria-disabled={pending}>
        {pending ? "Uploading…" : "Upload for redaction"}
      </Button>
    </form>
  );
}
