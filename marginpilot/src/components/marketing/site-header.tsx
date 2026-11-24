"use client";

import Link from "next/link";
import { useState } from "react";
import { BRAND } from "@/config/brand";
import { LinkButton } from "@/components/ui/button";
import { Container } from "@/components/ui/layout";
import { icons, Logo } from "@/components/ui/icons";
import { NAV } from "@/content/nav";


export function SiteHeader() {
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-paper">
      <a href="#main" className="skip-link rounded-md bg-ink px-3 py-2 text-sm font-semibold text-white">
        Skip to content
      </a>
      <Container className="flex h-16 items-center justify-between gap-4">
        <Link href="/" className="flex items-center gap-2 font-display text-lg font-semibold">
          <Logo />
          <span>{BRAND.name}</span>
        </Link>

        <nav aria-label="Main" className="hidden lg:block">
          <ul className="flex items-center gap-6 text-sm font-medium">
            {NAV.map((item) => (
              <li key={item.href}>
                <Link href={item.href} className="text-ink hover:text-accent">
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="hidden items-center gap-2 lg:flex">
          <LinkButton href="/login" variant="ghost">
            Log in
          </LinkButton>
          <LinkButton href="/signup">Start free trial</LinkButton>
        </div>

        <button
          type="button"
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md lg:hidden"
          aria-expanded={open}
          aria-controls="mobile-nav"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? icons.close : icons.menu}
          <span className="sr-only">{open ? "Close menu" : "Open menu"}</span>
        </button>
      </Container>

      {open && (
        <nav id="mobile-nav" aria-label="Main" className="border-t border-line bg-paper lg:hidden">
          <Container className="py-4">
            <ul className="flex flex-col">
              {NAV.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="block py-3 text-base font-medium"
                    onClick={() => setOpen(false)}
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
            <div className="mt-4 flex flex-col gap-2">
              <LinkButton href="/login" variant="secondary" size="lg">
                Log in
              </LinkButton>
              <LinkButton href="/signup" size="lg">
                Start free trial
              </LinkButton>
            </div>
          </Container>
        </nav>
      )}
    </header>
  );
}
