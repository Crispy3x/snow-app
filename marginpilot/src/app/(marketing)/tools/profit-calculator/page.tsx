import type { Metadata } from "next";
import { BRAND } from "@/config/brand";
import { LinkButton } from "@/components/ui/button";
import { Container } from "@/components/ui/layout";
import { ProfitCalculator } from "@/components/calculator/profit-calculator";

const title = "Free eBay profit calculator";
const description =
  "Work out net profit and margin on an eBay sale after final value fees, the per-order fee, promoted listing ads, sale discounts, tax and shipping, and the price you need for a target margin.";

export const metadata: Metadata = {
  title,
  description,
  openGraph: { title: `${title} | ${BRAND.name}`, description, type: "website" },
  twitter: { card: "summary", title: `${title} | ${BRAND.name}`, description },
};

/** Static page: the calculator runs in the browser and stores nothing. */
export default function ProfitCalculatorPage() {
  return (
    <>
      <section aria-labelledby="calc-heading" className="border-b border-line">
        <Container className="py-12 sm:py-16">
          <p className="mb-2 text-sm font-semibold uppercase tracking-wide text-accent">Free tool</p>
          <h1 id="calc-heading" className="text-4xl font-semibold leading-tight sm:text-5xl">
            eBay profit calculator
          </h1>
          <p className="mt-4 max-w-2xl text-lg text-ink-muted">
            See what you actually keep from a sale after eBay&rsquo;s fees, ad spend and your costs, and the lowest price that
            still hits your margin. Free, no sign-up, and nothing you type leaves your browser.
          </p>
        </Container>
      </section>

      <Container className="py-10 sm:py-12">
        <ProfitCalculator />
      </Container>

      <section aria-labelledby="how-heading" className="border-t border-line">
        <Container className="max-w-3xl py-12 sm:py-16">
          <h2 id="how-heading" className="text-3xl font-semibold">
            How the numbers are worked out
          </h2>
          <div className="mt-6 space-y-4 text-ink-muted">
            <p>
              <strong className="text-ink">Sale price</strong> is your list price less any sale discount. eBay charges its fees
              on what the buyer pays.
            </p>
            <p>
              <strong className="text-ink">eBay fees</strong> are the final value fee and the promoted listing ad rate (both a
              percentage of the sale price) plus the fixed per-order fee. The 13.6% default matches most US categories, but
              rates differ by category, by order size and with a store subscription, so use the rate from your own fee page.
            </p>
            <p>
              <strong className="text-ink">Landed cost</strong> is the item cost plus any sales tax your supplier charges, plus
              the shipping you pay to get it to the buyer.
            </p>
            <p>
              <strong className="text-ink">Net profit</strong> is the sale price minus fees minus landed cost, and{" "}
              <strong className="text-ink">net margin</strong> is net profit as a share of the sale price. The target price is
              the lowest list price whose net margin reaches your target after the same fees, ad rate and discount.
            </p>
            <p className="text-sm">
              Estimates only. Returns, international fees, payment holds and income tax aren&rsquo;t included. {BRAND.ebayDisclaimer}
            </p>
          </div>
        </Container>
      </section>

      <section aria-labelledby="calc-cta-heading" className="pb-16 sm:pb-20">
        <Container>
          <div className="rounded-lg bg-ink px-6 py-12 text-center text-white sm:px-12">
            <h2 id="calc-cta-heading" className="text-3xl font-semibold sm:text-4xl">
              Check every listing like this, automatically
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-white/85">
              {BRAND.name} runs this math on every price before it publishes, reprices or sends an offer, and holds anything
              below your margin floor.
            </p>
            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
              <LinkButton href="/signup" size="lg" variant="amber">
                Start free trial
              </LinkButton>
              <LinkButton href="/#pricing" size="lg" variant="onDark">
                Compare plans
              </LinkButton>
            </div>
          </div>
        </Container>
      </section>
    </>
  );
}
