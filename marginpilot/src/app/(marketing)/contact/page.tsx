import type { Metadata } from "next";
import { BRAND } from "@/config/brand";
import { Container } from "@/components/ui/layout";

export const metadata: Metadata = { title: "Contact" };

export default function ContactPage() {
  return (
    <Container className="max-w-3xl py-12 sm:py-16">
      <h1 className="text-4xl font-semibold">Contact</h1>
      <p className="mt-4 text-lg text-ink-muted">
        Questions about {BRAND.name}, billing or your account? Email us and we&rsquo;ll reply within two business days.
      </p>
      <p className="mt-6 text-lg">
        <a href={`mailto:${BRAND.supportEmail}`} className="font-semibold text-accent underline underline-offset-4">
          {BRAND.supportEmail}
        </a>
      </p>
      <p className="mt-10 text-sm text-ink-muted">{BRAND.ebayDisclaimer}</p>
    </Container>
  );
}
