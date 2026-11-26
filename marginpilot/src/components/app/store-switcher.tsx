import Link from "next/link";
import { getAppContext } from "@/lib/auth";
import { setCurrentStore } from "@/app/(app)/app/actions";
import { SubmitButton } from "@/components/ui/submit-button";

/** Server-rendered store switcher. Works without JavaScript (select + submit). */
export async function StoreSwitcher() {
  const ctx = await getAppContext();
  if (ctx.stores.length === 0) {
    return (
      <div className="rounded-md border border-line bg-paper p-3 text-sm">
        <p className="font-medium">No eBay store connected</p>
        <Link href="/app/stores" className="mt-1 inline-block font-semibold text-accent underline">
          Connect a store
        </Link>
      </div>
    );
  }
  return (
    <form action={setCurrentStore} className="rounded-md border border-line bg-paper p-3">
      <label htmlFor="store-switcher" className="block text-xs font-semibold uppercase tracking-wide text-ink-muted">
        Store
      </label>
      <div className="mt-1 flex gap-2">
        <select
          id="store-switcher"
          name="storeId"
          defaultValue={ctx.store?.id}
          className="min-h-10 w-full rounded-md border border-ink/25 bg-card px-2 text-sm"
        >
          {ctx.stores.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label || s.ebay_username || "eBay store"}
              {s.status !== "active" ? " (reconnect needed)" : ""}
            </option>
          ))}
        </select>
        <SubmitButton variant="secondary" pendingText="…" className="shrink-0">
          Switch
        </SubmitButton>
      </div>
    </form>
  );
}

export async function AccountChip() {
  const ctx = await getAppContext();
  return (
    <span className="hidden text-sm text-ink-muted sm:inline">
      {ctx.org.name} · {ctx.plan ? ctx.plan.name : "No plan"}
    </span>
  );
}
