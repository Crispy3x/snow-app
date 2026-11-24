import type { Metadata } from "next";
import Link from "next/link";
import { BRAND } from "@/config/brand";
import { LegalPage } from "@/components/marketing/legal-page";

export const metadata: Metadata = { title: "Terms of Service" };

export default function TermsPage() {
  const n = BRAND.name;
  return (
    <LegalPage title="Terms of Service" updated="[DATE]">
      <p>
        These Terms govern your use of {n} (the &ldquo;Service&rdquo;), provided by {BRAND.legalEntity}{" "}
        (&ldquo;we&rdquo;, &ldquo;us&rdquo;). By creating an account or buying the course you agree to these Terms.
      </p>

      <h2>1. The Service</h2>
      <p>
        {n} is software that helps eBay sellers list, price, monitor and fulfil items through eBay&rsquo;s official
        APIs, plus an educational video course. {BRAND.ebayDisclaimer}
      </p>

      <h2>2. Accounts</h2>
      <ul>
        <li>You must be at least 18 and able to form a binding contract.</li>
        <li>You are responsible for activity under your account, including team members you invite.</li>
        <li>You connect eBay stores using eBay&rsquo;s consent screen. We never ask for or store eBay passwords.</li>
      </ul>

      <h2>3. Your responsibilities as a seller</h2>
      <ul>
        <li>
          You remain the seller of record and are solely responsible for your listings, prices, items, delivery,
          returns, taxes and compliance with eBay&rsquo;s User Agreement and policies, including the drop shipping,
          VeRO and prohibited items policies.
        </li>
        <li>
          eBay allows drop shipping only from wholesale suppliers. You agree not to use the Service to buy items
          from another retailer or marketplace to be shipped directly to your buyers.
        </li>
        <li>You must review AI-generated drafts before approving them. You are responsible for content you publish or send.</li>
        <li>You must not use the Service to send unsolicited messages to eBay users or to use buyer data for any purpose other than fulfilling their orders.</li>
      </ul>

      <h2>4. Automation and eBay</h2>
      <p>
        Actions the Service takes on your store follow rules you configure. eBay may change, limit or remove API
        access at any time, which may affect the Service. We are not responsible for actions eBay takes on your
        account.
      </p>

      <h2>5. Subscriptions and payment</h2>
      <ul>
        <li>Subscriptions renew monthly until cancelled. You can cancel at any time from the billing page; access continues to the end of the paid period.</li>
        <li>Free trials convert to a paid plan unless cancelled before the trial ends.</li>
        <li>Plan limits (stores, listings, AI credits, seats) apply as described on the pricing page.</li>
        <li>Refunds are covered by our <Link href="/refund-policy">Refund Policy</Link>.</li>
      </ul>

      <h2>6. Course content</h2>
      <p>
        Course materials are licensed to you for personal, non-transferable use. You may not resell, share login
        access to, or republish course content.
      </p>

      <h2>7. No earnings promise</h2>
      <p>
        We do not promise any sales, income or results. See our <Link href="/earnings-disclaimer">Earnings Disclaimer</Link>.
      </p>

      <h2>8. Acceptable use</h2>
      <p>You may not misuse the Service, attempt to access other customers&rsquo; data, reverse engineer it, or use it to break any law or third-party right.</p>

      <h2>9. Testimonials you submit</h2>
      <p>
        If you submit a testimonial and give permission, you grant us a licence to display it with the name and
        details you provide. You can withdraw permission at any time by contacting us.
      </p>

      <h2>10. Disclaimers and limitation of liability</h2>
      <p>
        [LAWYER TO DRAFT: warranty disclaimer, liability cap (for example, fees paid in the prior 12 months),
        exclusion of indirect damages, indemnity, governing law and venue for [STATE/COUNTRY], dispute resolution.]
      </p>

      <h2>11. Termination</h2>
      <p>We may suspend accounts that breach these Terms. You may close your account at any time; we then delete your data as described in the Privacy Policy.</p>

      <h2>12. Changes</h2>
      <p>We may update these Terms and will notify you of material changes by email or in the app.</p>

      <h2>13. Contact</h2>
      <p>
        {BRAND.supportEmail} · [POSTAL ADDRESS]
      </p>
    </LegalPage>
  );
}
