import type { ReactNode } from "react";

export function Container({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-6xl px-4 sm:px-6 ${className}`}>{children}</div>;
}

export function Section({
  id,
  eyebrow,
  title,
  intro,
  children,
  className = "",
}: {
  id?: string;
  eyebrow?: string;
  title: string;
  intro?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const headingId = id ? `${id}-heading` : undefined;
  return (
    <section id={id} aria-labelledby={headingId} className={`scroll-mt-20 py-16 sm:py-20 ${className}`}>
      <Container>
        <div className="max-w-2xl">
          {eyebrow && (
            <p className="mb-2 text-sm font-semibold uppercase tracking-wide text-accent">{eyebrow}</p>
          )}
          <h2 id={headingId} className="text-3xl font-semibold sm:text-4xl">
            {title}
          </h2>
          {intro && <div className="mt-4 text-lg text-ink-muted">{intro}</div>}
        </div>
        <div className="mt-10">{children}</div>
      </Container>
    </section>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-lg border border-line bg-card p-6 ${className}`}>{children}</div>;
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "accent" | "amber" | "danger";
}) {
  const tones = {
    neutral: "bg-paper text-ink border-line",
    accent: "bg-accent-soft text-accent-strong border-accent/20",
    amber: "bg-amber-soft text-ink border-amber/60",
    danger: "bg-red-50 text-danger border-danger/20",
  };
  return (
    <span className={`inline-flex items-center rounded border px-2 py-0.5 text-xs font-semibold ${tones[tone]}`}>
      {children}
    </span>
  );
}
