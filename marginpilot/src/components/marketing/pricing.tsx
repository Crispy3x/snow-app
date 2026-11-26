import { cacheLife } from "next/cache";
import { PLANS, SALE, formatUsd, isSaleActive, salePrice } from "@/config/plans";
import { LinkButton } from "@/components/ui/button";
import { Badge, Section } from "@/components/ui/layout";
import { icons } from "@/components/ui/icons";

/** Re-evaluated every few minutes, so the sale price disappears on time without a redeploy. */
async function saleIsOn() {
  "use cache";
  cacheLife("minutes");
  return isSaleActive(new Date());
}

const SALE_END_LABEL = new Date(SALE.endsAt).toLocaleString("en-US", {
  month: "long",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "America/Los_Angeles",
  timeZoneName: "short",
});

export async function Pricing() {
  const onSale = await saleIsOn();

  return (
    <Section
      id="pricing"
      eyebrow="Pricing"
      title="Plans"
      intro="Monthly plans. Cancel any time from your billing page."
    >
      {onSale && (
        <div className="mb-8 flex flex-col gap-1 rounded-lg border-2 border-amber bg-amber-soft p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="font-display text-lg font-semibold">
            {SALE.name}: {SALE.percentOff}% off every plan
          </p>
          <p className="text-sm text-ink">
            Sign up by {SALE_END_LABEL} and keep half price for as long as you stay subscribed.
          </p>
        </div>
      )}

      <ul className="grid gap-6 lg:grid-cols-3">
        {PLANS.map((p) => {
          const price = onSale ? salePrice(p.monthly) : p.monthly;
          return (
            <li key={p.key}>
              <div
                className={`flex h-full flex-col rounded-lg bg-card p-6 ${
                  p.highlight ? "border-2 border-accent" : "border border-line"
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-xl font-semibold">{p.name}</h3>
                  <div className="flex gap-2">
                    {onSale && <Badge tone="amber">{SALE.percentOff}% off</Badge>}
                    {p.badge && <Badge tone="accent">{p.badge}</Badge>}
                  </div>
                </div>

                <p className="mt-4 flex flex-wrap items-baseline gap-x-2">
                  {onSale && (
                    <span className="text-lg text-ink-muted line-through">
                      <span className="sr-only">Regular price </span>
                      {formatUsd(p.monthly)}
                    </span>
                  )}
                  <span className="font-display text-4xl font-semibold">
                    {onSale && <span className="sr-only">{SALE.name} price </span>}
                    {formatUsd(price)}
                  </span>
                  <span className="text-ink-muted">/month</span>
                </p>

                <p className="mt-2 text-ink-muted">{p.blurb}</p>

                <ul className="mt-6 flex-1 space-y-3">
                  {p.features.map((f) => (
                    <li key={f} className="flex gap-2">
                      <span className="mt-0.5 text-accent">{icons.check}</span>
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>

                <LinkButton
                  href={`/signup?plan=${p.key}`}
                  size="lg"
                  variant={p.highlight ? "primary" : "secondary"}
                  className="mt-8"
                >
                  Start free trial
                  <span className="sr-only"> on the {p.name} plan</span>
                </LinkButton>
              </div>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
