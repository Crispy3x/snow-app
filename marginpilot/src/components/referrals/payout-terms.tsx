import { Badge } from "@/components/ui/layout";
import { BRAND } from "@/config/brand";
import { REFUND_WINDOW_DAYS } from "@/lib/referrals/commission";

/**
 * Referral payout terms. DRAFT: the owner should rewrite this (and have it
 * reviewed) before promoting the program. Keep it in sync with the commission
 * rules in src/lib/referrals/commission.ts and REFERRAL_COMMISSION_PCT.
 */
export function PayoutTerms({ commissionPct }: { commissionPct: number }) {
  return (
    <div className="space-y-3 text-sm">
      <p>
        <Badge tone="amber">Draft</Badge>{" "}
        <span className="text-ink-muted">These terms are a placeholder for the {BRAND.name} owner to edit before launch.</span>
      </p>
      <ul className="list-disc space-y-2 pl-5">
        <li>
          You earn {commissionPct}% of the first paid invoice of each new customer who signs up through your link. Free trial
          invoices of $0 don&rsquo;t count.
        </li>
        <li>The link remembers a visitor for 60 days. If someone else&rsquo;s link was used first, the first link wins.</li>
        <li>Referring yourself, your own team or accounts you control isn&rsquo;t eligible.</li>
        <li>
          Commissions stay pending for at least {REFUND_WINDOW_DAYS} days. If the payment is refunded in that time, the
          commission is voided.
        </li>
        <li>Every commission is reviewed and approved by hand before it is paid. We may decline referrals that look like abuse.</li>
        <li>
          Approved commissions are paid manually, typically once a month. Contact{" "}
          <a href={`mailto:${BRAND.supportEmail}`} className="font-medium text-accent underline underline-offset-2 hover:text-accent-strong">
            {BRAND.supportEmail}
          </a>{" "}
          to set up how you&rsquo;d like to be paid.
        </li>
        <li>We may change or end the program at any time; commissions already approved will still be paid.</li>
      </ul>
    </div>
  );
}
