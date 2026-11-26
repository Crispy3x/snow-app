import Link from "next/link";
import { Suspense } from "react";
import { BRAND } from "@/config/brand";
import { ADMIN_NAV } from "@/content/app-nav";
import { Logo } from "@/components/ui/icons";
import { Sidebar } from "@/components/app/sidebar";
import { requireAdmin } from "@/lib/auth";

export const metadata = { title: "Admin" };

/** Admin-only. Each admin page also calls requireAdmin(); this guard is for the shell. */
async function AdminGate({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  return <>{children}</>;
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <a href="#admin-main" className="skip-link rounded-md bg-ink px-3 py-2 text-sm font-semibold text-white">
        Skip to content
      </a>
      <header className="fixed inset-x-0 top-0 z-40 flex h-14 items-center justify-between gap-3 border-b border-line bg-ink px-4 text-white">
        <Link href="/admin" className="flex items-center gap-2 font-display font-semibold">
          <Logo />
          <span>{BRAND.name} admin</span>
        </Link>
        <div className="flex items-center gap-2">
          <Link href="/app" className="min-h-10 rounded-md px-3 py-2 text-sm font-medium hover:bg-white/10">
            Back to app
          </Link>
          <Sidebar groups={[{ label: "Admin", items: ADMIN_NAV }]} label="Admin" />
        </div>
      </header>
      <main id="admin-main" className="px-4 pb-16 pt-20 sm:px-6 lg:ml-64 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <Suspense fallback={<p className="text-ink-muted">Loading…</p>}>
            <AdminGate>{children}</AdminGate>
          </Suspense>
        </div>
      </main>
    </div>
  );
}
