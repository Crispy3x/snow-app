import type { ReactNode } from "react";
import { Container } from "@/components/ui/layout";

/** Narrow centred card used by login, signup and password pages. */
export function AuthCard({ title, intro, children, footer }: { title: string; intro?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <Container className="max-w-md py-10 sm:py-16">
      <h1 className="text-3xl font-semibold">{title}</h1>
      {intro && <div className="mt-2 text-ink-muted">{intro}</div>}
      <div className="mt-6 rounded-lg border border-line bg-card p-5 sm:p-6">{children}</div>
      {footer && <div className="mt-6 text-sm text-ink-muted">{footer}</div>}
    </Container>
  );
}

/** Placeholder while a session-dependent form streams in. */
export function FormSkeleton({ rows = 2 }: { rows?: number }) {
  return (
    <div aria-hidden="true" className="space-y-4">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i}>
          <div className="mb-1 h-4 w-24 rounded bg-line" />
          <div className="h-10 rounded-md bg-paper" />
        </div>
      ))}
      <div className="h-10 rounded-md bg-line" />
    </div>
  );
}

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export function firstParam(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}
