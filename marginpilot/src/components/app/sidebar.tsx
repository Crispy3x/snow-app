"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { icons } from "@/components/ui/icons";
import type { NavGroup } from "@/content/app-nav";

function isActive(pathname: string, href: string) {
  if (href === "/app" || href === "/admin") return pathname === href;
  return pathname === href || pathname.startsWith(href + "/");
}

/** Sidebar on desktop; a toggled panel on phones. `footer` holds the store switcher etc. */
export function Sidebar({ groups, label, footer }: { groups: NavGroup[]; label: string; footer?: ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  // The most specific matching href wins, so /app/listings/new doesn't also light up /app/listings.
  const all = groups.flatMap((g) => g.items.map((i) => i.href));
  const active = all.filter((h) => isActive(pathname, h)).sort((a, b) => b.length - a.length)[0];

  const nav = (
    <nav aria-label={label} className="space-y-6">
      {groups.map((g) => (
        <div key={g.label}>
          <h2 className="px-3 text-xs font-semibold uppercase tracking-wide text-ink-muted">{g.label}</h2>
          <ul className="mt-2 space-y-0.5">
            {g.items.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={() => setOpen(false)}
                  aria-current={item.href === active ? "page" : undefined}
                  className={`block rounded-md px-3 py-2 text-sm ${
                    item.href === active ? "bg-accent-soft font-semibold text-accent-strong" : "text-ink hover:bg-ink/5"
                  }`}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );

  return (
    <>
      <button
        type="button"
        className="inline-flex min-h-11 items-center gap-2 rounded-md px-2 text-sm font-medium lg:hidden"
        aria-expanded={open}
        aria-controls="app-mobile-nav"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? icons.close : icons.menu}
        <span>{open ? "Close menu" : "Menu"}</span>
      </button>
      {open && (
        <div id="app-mobile-nav" className="fixed inset-x-0 top-14 bottom-0 z-30 overflow-y-auto border-t border-line bg-paper p-4 lg:hidden">
          {footer && <div className="mb-6">{footer}</div>}
          {nav}
        </div>
      )}
      <aside className="fixed top-14 bottom-0 left-0 hidden w-64 overflow-y-auto border-r border-line bg-card p-4 lg:block">
        {footer && <div className="mb-6">{footer}</div>}
        {nav}
      </aside>
    </>
  );
}
