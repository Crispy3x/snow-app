import { CopyButton } from "@/components/automation/copy-button";

/** A read-only, selectable link with a copy button. */
export function ReferralLink({ id, label, url }: { id: string; label: string; url: string }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">
        {label}
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          id={id}
          readOnly
          value={url}
          className="block min-h-10 w-full min-w-0 rounded-md border border-ink/25 bg-paper px-3 py-2 font-mono text-sm text-ink"
        />
        <CopyButton text={url} label="Copy link" />
      </div>
    </div>
  );
}
