import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import { formatUsd, getPlan, PLANS, SALE, salePrice } from "@/config/plans";
import { saleIsOn } from "@/lib/sale";
import { safeNext } from "@/lib/account/redirect";
import { trialDays } from "@/lib/billing/stripe";
import { AuthCard, FormSkeleton, firstParam, type SearchParams } from "@/components/account/auth-card";
import { SignupForm } from "./signup-form";

export const metadata: Metadata = { title: "Start your free trial" };

export default function SignupPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<AuthCard title="Start your free trial"><FormSkeleton rows={3} /></AuthCard>}>
      <SignupBody searchParams={searchParams} />
    </Suspense>
  );
}

async function SignupBody({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const rawNext = firstParam(sp.next);
  const next = rawNext ? safeNext(rawNext) : "";
  const plan = getPlan(firstParam(sp.plan) ?? "");

  if (await getUser()) redirect(next || (plan ? `/api/stripe/checkout?plan=${plan.key}` : "/app"));

  const sale = await saleIsOn();
  const days = trialDays();
  const price = (p: (typeof PLANS)[number]) => (sale ? `${formatUsd(salePrice(p.monthly))}/mo (${SALE.name} price)` : `${formatUsd(p.monthly)}/mo`);
  const planOptions = [
    ...PLANS.map((p) => ({ value: p.key, label: `${p.name}, ${price(p)}` })),
    { value: "", label: "Decide later" },
  ];
  const invite = next.startsWith("/auth/invite");
  const loginHref = next ? `/login?next=${encodeURIComponent(next)}` : "/login";

  return (
    <AuthCard
      title={invite ? "Create your account" : "Start your free trial"}
      intro={
        invite ? (
          "Create an account to join your team."
        ) : (
          <>
            <p>
              {days > 0 ? `${days} days free, then billed monthly. ` : "Billed monthly. "}Cancel any time from the billing page.
            </p>
            {sale && (
              <p className="mt-2 font-medium text-ink">
                {SALE.name}: {SALE.percentOff}% off for as long as you stay subscribed, for sign-ups before December 31.
              </p>
            )}
          </>
        )
      }
      footer={
        <>
          <p>
            Already have an account?{" "}
            <Link href={loginHref} className="font-medium text-accent underline underline-offset-2 hover:text-accent-strong">
              Log in
            </Link>
          </p>
          <p className="mt-3">
            By creating an account you agree to the{" "}
            <Link href="/terms" className="underline underline-offset-2">
              Terms
            </Link>{" "}
            and{" "}
            <Link href="/privacy" className="underline underline-offset-2">
              Privacy Policy
            </Link>
            .
          </p>
        </>
      }
    >
      <SignupForm
        plan={plan?.key ?? ""}
        next={next}
        planOptions={planOptions}
        submitLabel={invite ? "Create account" : "Create account and continue"}
      />
    </AuthCard>
  );
}
