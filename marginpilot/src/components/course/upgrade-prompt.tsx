import { LinkButton } from "@/components/ui/button";
import { PLANS } from "@/config/plans";
import { coursePriceId } from "@/lib/billing/stripe";

/** Shown to signed-in users without course access. Links to billing (plans and course purchase). */
export function UpgradePrompt({ compact = false }: { compact?: boolean }) {
  const included = PLANS.filter((p) => p.limits.course).map((p) => p.name);
  const canBuy = !!coursePriceId();
  return (
    <section aria-labelledby="course-upgrade-heading" className="rounded-lg border border-amber bg-amber-soft p-5">
      <h2 id="course-upgrade-heading" className="text-lg font-semibold">
        {compact ? "This lesson is part of the full course" : "Unlock the full course"}
      </h2>
      <p className="mt-1 max-w-2xl text-sm">
        The course is included with the {included.join(" and ")} plans{canBuy ? ", or you can buy it on its own" : ""}. Lessons marked
        &ldquo;Free preview&rdquo; are open to everyone.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <LinkButton href="/app/billing?reason=course">Upgrade your plan</LinkButton>
        {canBuy && (
          <LinkButton href="/api/stripe/course-checkout" variant="secondary">
            Buy the course
          </LinkButton>
        )}
      </div>
    </section>
  );
}
