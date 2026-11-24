import Link from "next/link";
import { BRAND } from "@/config/brand";
import { Container } from "@/components/ui/layout";
import { Logo } from "@/components/ui/icons";
import { NAV } from "@/content/nav";

async function CopyrightYear() {
  "use cache";
  return <>{new Date().getFullYear()}</>;
}

const LEGAL = [
  { href: "/terms", label: "Terms" },
  { href: "/privacy", label: "Privacy" },
  { href: "/earnings-disclaimer", label: "Earnings Disclaimer" },
  { href: "/refund-policy", label: "Refund Policy" },
  { href: "/contact", label: "Contact" },
];

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-line bg-card">
      <Container className="grid gap-10 py-12 md:grid-cols-3">
        <div>
          <Link href="/" className="flex items-center gap-2 font-display text-lg font-semibold">
            <Logo />
            <span>{BRAND.name}</span>
          </Link>
          <p className="mt-3 max-w-xs text-sm text-ink-muted">{BRAND.description}</p>
        </div>
        <nav aria-label="Product">
          <h2 className="text-sm font-semibold">Product</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {NAV.map((item) => (
              <li key={item.href}>
                <Link href={item.href} className="text-ink-muted hover:text-accent">
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <nav aria-label="Legal">
          <h2 className="text-sm font-semibold">Company</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {LEGAL.map((item) => (
              <li key={item.href}>
                <Link href={item.href} className="text-ink-muted hover:text-accent">
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </Container>
      <div className="border-t border-line">
        <Container className="flex flex-col gap-2 py-6 text-sm text-ink-muted sm:flex-row sm:justify-between">
          <p>
            © <CopyrightYear /> {BRAND.legalEntity}
          </p>
          <p>{BRAND.ebayDisclaimer}</p>
        </Container>
      </div>
    </footer>
  );
}
