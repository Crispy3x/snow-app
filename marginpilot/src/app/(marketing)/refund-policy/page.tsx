import type { Metadata } from "next";
import { BRAND } from "@/config/brand";
import { LegalPage } from "@/components/marketing/legal-page";

export const metadata: Metadata = { title: "Refund Policy" };

export default function RefundPolicyPage() {
  return (
    <LegalPage title="Refund Policy" updated="[DATE]">
      <p>[OPERATOR TO DECIDE the numbers in brackets. The structure below is a common starting point.]</p>

      <h2>Subscriptions (Starter and Growth)</h2>
      <ul>
        <li>New subscriptions start with a [7]-day free trial. Cancel before it ends and you won&rsquo;t be charged.</li>
        <li>You can cancel any time from the billing page. Cancellation stops future renewals; access continues until the end of the current paid month.</li>
        <li>We don&rsquo;t refund partial months, except where the law requires or at our discretion for billing errors.</li>
        <li>If you were charged after cancelling because of an error on our side, we will refund that charge in full.</li>
      </ul>

      <h2>Course (one-time purchase)</h2>
      <ul>
        <li>You can request a full refund within [14] days of purchase if you have completed less than [20%] of the lessons and have not downloaded [more than two] resources.</li>
        <li>After that, course purchases are non-refundable because the content has been delivered.</li>
        <li>Refunded purchases lose course access.</li>
      </ul>

      <h2>Growth plan course access</h2>
      <p>Course access on Growth lasts while the subscription is active. It ends when the subscription ends unless you bought the course separately.</p>

      <h2>How to ask</h2>
      <p>Email {BRAND.supportEmail} from your account email with your order details. Approved refunds go back to the original payment method through Stripe, usually within 5 to 10 business days.</p>

      <p>[LAWYER: check consumer-law cooling-off rights for EU/UK buyers of digital content and subscriptions.]</p>
    </LegalPage>
  );
}
