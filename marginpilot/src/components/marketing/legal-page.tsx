import type { ReactNode } from "react";
import { Container } from "@/components/ui/layout";

/**
 * Wrapper for legal pages. The draft banner stays until a lawyer has reviewed
 * the text and you set draft={false} on the page.
 */
export function LegalPage({
  title,
  updated,
  draft = true,
  children,
}: {
  title: string;
  updated: string;
  draft?: boolean;
  children: ReactNode;
}) {
  return (
    <Container className="max-w-3xl py-12 sm:py-16">
      {draft && (
        <div role="note" className="mb-8 rounded-md border-2 border-amber bg-amber-soft p-4 text-sm">
          <p className="font-semibold">Draft for legal review</p>
          <p className="mt-1">
            This text is a working draft, not legal advice, and has not been reviewed by a lawyer. Bracketed
            items such as [COMPANY LEGAL NAME] must be filled in before launch.
          </p>
        </div>
      )}
      <h1 className="text-4xl font-semibold">{title}</h1>
      <p className="mt-2 text-sm text-ink-muted">Last updated: {updated}</p>
      <div className="prose-legal mt-8">{children}</div>
    </Container>
  );
}
