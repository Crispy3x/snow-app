import Link from "next/link";
import { Suspense } from "react";
import { BRAND } from "@/config/brand";
import { APP_NAV } from "@/content/app-nav";
import { Logo } from "@/components/ui/icons";
import { Sidebar } from "@/components/app/sidebar";
import { AccountChip, StoreSwitcher } from "@/components/app/store-switcher";
import { signOut } from "./actions";

export const metadata = { title: "App" };

/**
 * Signed-in shell. The chrome is static; anything that reads the session
 * (store switcher, account chip, page content) streams in behind Suspense.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <a href="#app-main" className="skip-link rounded-md bg-ink px-3 py-2 text-sm font-semibold text-white">
        Skip to content
      </a>
      <header className="fixed inset-x-0 top-0 z-40 flex h-14 items-center justify-between gap-3 border-b border-line bg-card px-4">
        <div className="flex items-center gap-3">
          <Link href="/app" className="flex items-center gap-2 font-display font-semibold">
            <Logo />
            <span>{BRAND.name}</span>
          </Link>
        </div>
        <div className="flex items-center gap-3">
          <Suspense fallback={null}>
            <AccountChip />
          </Suspense>
          <form action={signOut}>
            <button type="submit" className="min-h-10 rounded-md px-3 text-sm font-medium hover:bg-ink/5">
              Sign out
            </button>
          </form>
          <Sidebar
            groups={APP_NAV}
            label="App"
            footer={
              <Suspense fallback={<div className="h-20 rounded-md border border-line bg-paper" />}>
                <StoreSwitcher />
              </Suspense>
            }
          />
        </div>
      </header>
      <main id="app-main" className="px-4 pb-16 pt-20 sm:px-6 lg:ml-64 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <Suspense fallback={<p className="text-ink-muted">Loading…</p>}>{children}</Suspense>
        </div>
      </main>
    </div>
  );
}
