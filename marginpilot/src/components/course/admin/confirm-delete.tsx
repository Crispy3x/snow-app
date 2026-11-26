/**
 * Two-step delete without relying on JavaScript dialogs: open the disclosure,
 * read the warning, then press the explicit confirm button.
 */
export function ConfirmDelete({
  action,
  id,
  summary,
  warning,
  confirmText,
  extra,
}: {
  action: (formData: FormData) => Promise<void>;
  id: string;
  summary: string;
  warning: string;
  confirmText: string;
  extra?: Record<string, string>;
}) {
  return (
    <details className="rounded-md border border-danger/30 p-3">
      <summary className="cursor-pointer text-sm font-semibold text-danger">{summary}</summary>
      <form action={action} className="mt-3 space-y-3">
        <input type="hidden" name="id" value={id} />
        {extra && Object.entries(extra).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        <p className="text-sm">{warning} This can&rsquo;t be undone.</p>
        <button
          type="submit"
          className="inline-flex min-h-10 items-center justify-center rounded-md bg-danger px-4 text-sm font-semibold text-white hover:bg-danger/90"
        >
          {confirmText}
        </button>
      </form>
    </details>
  );
}
