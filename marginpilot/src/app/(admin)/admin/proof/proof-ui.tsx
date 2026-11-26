import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Badge } from "@/components/ui/layout";
import { SubmitButton } from "@/components/ui/submit-button";

/** Shared bits for the proof admin pages (server components). */

export function ProofTabs({ current, pending }: { current: "screenshots" | "testimonials"; pending: { screenshots: number; testimonials: number } }) {
  const tabs = [
    { key: "screenshots", href: "/admin/proof", label: "Screenshots", count: pending.screenshots },
    { key: "testimonials", href: "/admin/proof/testimonials", label: "Testimonials", count: pending.testimonials },
  ] as const;
  return (
    <nav aria-label="Proof sections" className="mb-6 flex gap-2 border-b border-line">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={current === t.key ? "page" : undefined}
          className={`-mb-px flex min-h-10 items-center gap-2 border-b-2 px-3 py-2 text-sm font-semibold ${
            current === t.key ? "border-accent text-ink" : "border-transparent text-ink-muted hover:text-ink"
          }`}
        >
          {t.label}
          {t.count > 0 && <Badge tone="amber">{t.count} pending</Badge>}
        </Link>
      ))}
    </nav>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const tone = status === "approved" ? "accent" : status === "rejected" ? "danger" : "amber";
  const label = status === "approved" ? "Published" : status === "rejected" ? "Rejected" : "Pending review";
  return <Badge tone={tone}>{label}</Badge>;
}

/** Up/down buttons as small forms (work without JavaScript). */
export function MoveButtons({ id, label, action, first, last }: { id: string; label: string; action: (fd: FormData) => Promise<void>; first: boolean; last: boolean }) {
  return (
    <div className="flex gap-1" role="group" aria-label={`Order of ${label}`}>
      {(["up", "down"] as const).map((dir) => (
        <form key={dir} action={action}>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="direction" value={dir} />
          <SubmitButton
            variant="secondary"
            pendingText="…"
            disabled={dir === "up" ? first : last}
            aria-label={`Move ${label} ${dir}`}
          >
            {dir === "up" ? "Up" : "Down"}
          </SubmitButton>
        </form>
      ))}
    </div>
  );
}

export function ActionButton({
  id,
  action,
  children,
  variant = "secondary",
  danger,
}: {
  id: string;
  action: (fd: FormData) => Promise<void>;
  children: React.ReactNode;
  variant?: "primary" | "secondary";
  danger?: boolean;
}) {
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <SubmitButton variant={variant} pendingText="Working…" className={danger ? "text-danger" : ""}>
        {children}
      </SubmitButton>
    </form>
  );
}

export async function pendingCounts(db: SupabaseClient) {
  const [s, t] = await Promise.all([
    db.from("proof_screenshots").select("id", { count: "exact", head: true }).eq("status", "pending"),
    db.from("testimonials").select("id", { count: "exact", head: true }).eq("status", "pending"),
  ]);
  return { screenshots: s.count ?? 0, testimonials: t.count ?? 0 };
}
