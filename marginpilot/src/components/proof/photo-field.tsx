"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Optional photo picker for testimonials. The browser shrinks the photo to a
 * small JPEG before upload: it keeps the request under the server action size
 * limit and drops EXIF data such as GPS location. The server re-encodes it again.
 */

const MAX_SIDE = 640;

async function shrink(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas");
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode failed"))), "image/jpeg", 0.85),
  );
}

export function usePhoto() {
  const [blob, setBlob] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  async function onFile(file: File | undefined) {
    setError(null);
    setBlob(null);
    setPreview(null);
    if (!file) return;
    try {
      const small = await shrink(file);
      setBlob(small);
      setPreview(URL.createObjectURL(small));
    } catch {
      setError("That photo couldn't be read. Use a JPEG, PNG or WebP image.");
    }
  }

  /** Put the shrunk photo into the FormData in place of the original file. */
  function apply(fd: FormData) {
    fd.delete("photo");
    if (blob) fd.set("photo", blob, "photo.jpg");
  }

  const reset = useCallback(() => {
    setBlob(null);
    setPreview(null);
    setError(null);
  }, []);

  return { blob, preview, error, onFile, apply, reset };
}

export function PhotoField({
  id,
  label = "Photo (optional)",
  hint,
  photo,
  serverError,
}: {
  id: string;
  label?: string;
  hint?: string;
  photo: ReturnType<typeof usePhoto>;
  serverError?: string;
}) {
  const err = photo.error ?? serverError;
  const describedBy = err ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">
        {label}
      </label>
      <div className="flex items-center gap-3">
        {photo.preview && (
          // eslint-disable-next-line @next/next/no-img-element -- local preview blob
          <img src={photo.preview} alt="Selected photo preview" width={56} height={56} className="h-14 w-14 rounded-full border border-line object-cover" />
        )}
        <input
          id={id}
          name="photo"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          aria-describedby={describedBy}
          aria-invalid={err ? true : undefined}
          onChange={(e) => photo.onFile(e.currentTarget.files?.[0])}
          className="block w-full text-sm file:mr-3 file:min-h-10 file:rounded-md file:border file:border-ink/20 file:bg-card file:px-3 file:font-semibold file:text-ink"
        />
      </div>
      {hint && !err && (
        <p id={`${id}-hint`} className="mt-1 text-sm text-ink-muted">
          {hint}
        </p>
      )}
      {err && (
        <p id={`${id}-error`} className="mt-1 text-sm font-medium text-danger">
          {err}
        </p>
      )}
    </div>
  );
}
