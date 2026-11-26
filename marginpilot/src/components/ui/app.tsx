import Link from "next/link";
import type { ReactNode } from "react";

/** Building blocks for signed-in pages. */

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold sm:text-3xl">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-ink-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Panel({ title, description, children, actions, className = "" }: { title?: string; description?: ReactNode; children: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border border-line bg-card ${className}`}>
      {(title || actions) && (
        <div className="flex flex-col gap-2 border-b border-line px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            {title && <h2 className="text-lg font-semibold">{title}</h2>}
            {description && <p className="text-sm text-ink-muted">{description}</p>}
          </div>
          {actions}
        </div>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

export function Alert({ tone = "info", title, children }: { tone?: "info" | "warning" | "danger" | "success"; title?: string; children: ReactNode }) {
  const tones = {
    info: "border-line bg-card",
    warning: "border-amber bg-amber-soft",
    danger: "border-danger/30 bg-red-50 text-danger",
    success: "border-accent/30 bg-accent-soft text-accent-strong",
  };
  return (
    <div role={tone === "danger" ? "alert" : "note"} className={`rounded-md border px-4 py-3 text-sm ${tones[tone]}`}>
      {title && <p className="font-semibold">{title}</p>}
      <div className={title ? "mt-1" : ""}>{children}</div>
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-ink/25 bg-card px-6 py-10 text-center">
      <p className="font-display text-lg font-semibold">{title}</p>
      {children && <div className="mx-auto mt-2 max-w-md text-ink-muted">{children}</div>}
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}

export function StatCard({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-card p-4">
      <p className="text-sm text-ink-muted">{label}</p>
      <p className="mt-1 font-display text-2xl font-semibold tabular-nums">{value}</p>
      {sub && <p className="mt-1 text-xs text-ink-muted">{sub}</p>}
    </div>
  );
}

/** Responsive table wrapper: scrolls sideways on phones, keyboard-focusable. */
export function DataTable({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-card" tabIndex={0} role="region" aria-label={caption}>
      <table className="w-full min-w-[640px] text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        {children}
      </table>
    </div>
  );
}

export const th = "px-4 py-2 font-medium text-ink-muted border-b border-line";
export const td = "px-4 py-3 border-b border-line align-top";

export function TextLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="font-medium text-accent underline underline-offset-2 hover:text-accent-strong">
      {children}
    </Link>
  );
}

export function money(n: number | string | null | undefined): string {
  if (n === null || n === undefined || n === "") return "–";
  return Number(n).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function pct(n: number | string | null | undefined): string {
  if (n === null || n === undefined || n === "") return "–";
  return `${Number(n).toFixed(1)}%`;
}
