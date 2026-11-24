import type { Metadata } from "next";
import { BRAND } from "@/config/brand";
import { LegalPage } from "@/components/marketing/legal-page";

export const metadata: Metadata = { title: "Privacy Policy" };

export default function PrivacyPage() {
  const n = BRAND.name;
  return (
    <LegalPage title="Privacy Policy" updated="[DATE]">
      <p>
        This policy explains what {BRAND.legalEntity} collects when you use {n}, why, and your choices.
      </p>

      <h2>1. What we collect</h2>
      <ul>
        <li><strong>Account data:</strong> name, email, password hash (managed by our auth provider), team members you invite.</li>
        <li><strong>Billing data:</strong> handled by Stripe. We store your Stripe customer ID and plan, not card numbers.</li>
        <li>
          <strong>eBay store data:</strong> when you connect a store through eBay&rsquo;s consent screen we receive OAuth
          tokens (encrypted at rest) and access listing, order, offer, marketing and performance data for that
          store. We never receive or store your eBay password.
        </li>
        <li>
          <strong>Your buyers&rsquo; data:</strong> to fulfil orders we process ship-to names, addresses and order
          details that eBay provides. We use this only to help you fulfil and support those orders, keep it only as
          long as needed for that purpose and any return window, then delete it.
        </li>
        <li><strong>Supplier and product data</strong> you add, and the rules you configure.</li>
        <li><strong>AI usage:</strong> prompts and outputs of the AI tools, logged to your account for history, metering and support.</li>
        <li><strong>Proof submissions:</strong> testimonials and screenshots you choose to submit.</li>
        <li><strong>Usage and device data:</strong> logs, IP address, browser type, for security and reliability.</li>
      </ul>

      <h2>2. How we use it</h2>
      <p>To provide and secure the Service, run the automations you configure, bill you, provide support, and improve the product. We do not sell personal information. We do not use eBay data or your buyers&rsquo; data to train AI models.</p>

      <h2>3. Service providers</h2>
      <ul>
        <li>Supabase (database, authentication, file storage)</li>
        <li>Vercel (hosting)</li>
        <li>Stripe (payments)</li>
        <li>Anthropic (AI processing of the content you send to the AI tools; not used for model training under our API terms)</li>
        <li>Inngest (background job scheduling)</li>
        <li>[EMAIL PROVIDER] (transactional email)</li>
      </ul>
      <p>We minimise personal data sent to AI providers. Buyer names and addresses are removed from AI prompts where they are not needed for the task.</p>

      <h2>4. eBay data</h2>
      <p>
        Our use of data obtained from eBay is subject to eBay&rsquo;s API License Agreement and is consistent with
        eBay&rsquo;s User Privacy Notice. When eBay notifies us that a user has closed their eBay account, we delete
        that user&rsquo;s data unless the law requires us to keep it.
      </p>

      <h2>5. Retention</h2>
      <p>[LAWYER/OPERATOR TO CONFIRM PERIODS] Account data: while your account is open plus [30] days. Buyer order data: until the order&rsquo;s return window closes plus [X] days. AI logs: [12] months. Billing records: as required by tax law.</p>

      <h2>6. Security</h2>
      <p>Data is encrypted in transit. OAuth tokens are encrypted at rest with a key kept outside the database. Access is restricted by row-level security so each customer sees only their own data.</p>

      <h2>7. Your rights</h2>
      <p>Depending on where you live, you may have rights to access, correct, delete or export your data, and to object to certain processing. Email {BRAND.supportEmail}. [LAWYER: add GDPR/UK GDPR legal bases and CCPA/CPRA disclosures as applicable.]</p>

      <h2>8. Cookies</h2>
      <p>We use essential cookies for sign-in and security. [List analytics cookies if added.]</p>

      <h2>9. Contact</h2>
      <p>{BRAND.supportEmail} · [POSTAL ADDRESS]</p>
    </LegalPage>
  );
}
