import type { Metadata } from "next";
import { Container } from "@/components/ui/layout";

export const metadata: Metadata = { title: "Start your free trial" };

// Placeholder until phase 2 (Supabase auth + Stripe checkout).
export default function Page() {
  return (
    <Container className="max-w-md py-16">
      <h1 className="text-3xl font-semibold">Start your free trial</h1>
      <p className="mt-4 text-ink-muted">Accounts open soon. This page is wired up in the next build phase.</p>
    </Container>
  );
}
