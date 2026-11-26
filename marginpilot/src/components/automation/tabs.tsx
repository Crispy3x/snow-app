import Link from "next/link";

/** Simple link tabs driven by a search param. */
export function LinkTabs({ tabs, current, label }: { tabs: { href: string; label: string; key: string }[]; current: string; label: string }) {
  return (
    <nav aria-label={label} className="mb-4 flex gap-1 overflow-x-auto border-b border-line">
      {tabs.map((t) => {
        const active = t.key === current;
        return (
          <Link
            key={t.key}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={`-mb-px min-h-10 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${
              active ? "border-accent text-ink" : "border-transparent text-ink-muted hover:text-ink"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
