/**
 * The single place the product name and brand-level copy live.
 * Change BRAND.name here and it changes across the site, app, emails and legal pages.
 */
export const BRAND = {
  name: "MarginPilot",
  legalEntity: "[COMPANY LEGAL NAME, LLC]",
  domain: "marginpilot.com",
  supportEmail: "support@marginpilot.com",
  tagline: "Run your eBay store on rules, not on hours.",
  description:
    "Automation software and a video course for eBay sellers: bulk AI listing, margin guard, price and stock sync, order queue, and store cleanup.",
  ebayDisclaimer:
    "Not affiliated with eBay Inc. eBay is a trademark of eBay Inc.",
  resultsDisclaimer:
    "Results shown are from specific stores and are not typical. We don't promise sales or income.",
} as const;

/**
 * Plan prices are placeholders until you set them. Use null to render "[PRICE]".
 * Stripe price IDs come from env vars (see .env.example), not from here.
 */
export const PRICING = {
  starter: { monthly: null as number | null },
  growth: { monthly: null as number | null },
  course: { oneTime: null as number | null },
};

export function formatPrice(value: number | null): string {
  return value === null ? "[PRICE]" : `$${value}`;
}
