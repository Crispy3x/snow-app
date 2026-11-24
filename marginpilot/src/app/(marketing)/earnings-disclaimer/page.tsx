import type { Metadata } from "next";
import { BRAND } from "@/config/brand";
import { LegalPage } from "@/components/marketing/legal-page";

export const metadata: Metadata = { title: "Earnings Disclaimer" };

export default function EarningsDisclaimerPage() {
  const n = BRAND.name;
  return (
    <LegalPage title="Earnings Disclaimer" updated="[DATE]">
      <p>
        {n} sells software and educational content. We do not promise, guarantee or imply that you will make any
        sales, income or profit by using them.
      </p>

      <h2>Results are not typical</h2>
      <p>
        Screenshots and testimonials on our site come from specific stores, were provided with permission, and show
        the date range they cover. They are not typical. Most people who start selling online make little or no
        money. Your results depend on many things we don&rsquo;t control, including your products, suppliers, prices,
        effort, experience, customer service, eBay&rsquo;s policies and fees, and market conditions.
      </p>

      <h2>Not financial, legal or tax advice</h2>
      <p>Course content and software outputs, including AI-generated suggestions and margin calculations, are for general information. Check fees, taxes and policies yourself and consult qualified professionals.</p>

      <h2>Margin calculations are estimates</h2>
      <p>The margin engine uses fee rates you can edit. eBay fees vary by category, store subscription and promotion, and can change. Actual net results may differ.</p>

      <h2>Your responsibility</h2>
      <p>You are responsible for your decisions and for complying with eBay&rsquo;s policies, including the requirement that drop-shipped items come from a wholesale supplier.</p>

      <p>{BRAND.ebayDisclaimer}</p>
      <p>[LAWYER: confirm compliance with FTC Endorsement Guides and the FTC Business Opportunity / earnings claims rules.]</p>
    </LegalPage>
  );
}
