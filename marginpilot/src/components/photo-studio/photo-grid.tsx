"use client";

export type GridImage = { id: string; label: string; url: string };

/**
 * Studio results with a "Keep" checkbox each. The checkboxes belong to the form
 * named by `formId` (HTML form attribute), so the grid can sit outside that form.
 */
export function PhotoGrid({
  images,
  kept,
  onToggle,
  formId,
}: {
  images: GridImage[];
  kept: Set<string>;
  onToggle: (id: string, keep: boolean) => void;
  formId: string;
}) {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" aria-label="Photo versions">
      {images.map((img) => {
        const id = `keep-${img.id}`;
        const on = kept.has(img.id);
        return (
          <li key={img.id} className={`rounded-md border-2 bg-card p-1.5 ${on ? "border-accent" : "border-line"}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={img.url} alt={img.label} className="aspect-square w-full rounded bg-paper object-contain" />
            <div className="mt-1.5 flex items-center gap-2 px-0.5">
              <input
                id={id}
                type="checkbox"
                name="keep"
                value={img.id}
                form={formId}
                checked={on}
                onChange={(e) => onToggle(img.id, e.target.checked)}
                className="h-4 w-4 accent-accent"
              />
              <label htmlFor={id} className="min-w-0 flex-1 truncate text-sm">
                Keep <span className="text-ink-muted">{img.label}</span>
              </label>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
