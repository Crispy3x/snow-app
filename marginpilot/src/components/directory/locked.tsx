import { LinkButton } from "@/components/ui/button";
import { PLANS } from "@/config/plans";

/** Shown to workspaces whose plan doesn't include the directory. Only the published count is revealed. */
export function LockedDirectory({ count }: { count: number }) {
  const included = PLANS.filter((p) => p.limits.supplierDirectory).map((p) => p.name);
  return (
    <section aria-labelledby="directory-locked-heading" className="rounded-lg border border-amber bg-amber-soft p-5">
      <h2 id="directory-locked-heading" className="text-lg font-semibold">
        The supplier directory is part of the {included.join(" and ")} plans
      </h2>
      <p className="mt-2 max-w-2xl text-sm">
        {count > 0
          ? `${count.toLocaleString()} vetted wholesale ${count === 1 ? "supplier is" : "suppliers are"} listed right now.`
          : "Our team is still vetting the first suppliers for the directory."}{" "}
        Each one is checked by our team for wholesale accounts, drop shipping, handling times and tracking. Upgrade to see contact
        details, shipping expectations and add them to your suppliers in one step.
      </p>
      <div className="mt-4">
        <LinkButton href="/app/billing?reason=directory">See plans</LinkButton>
      </div>
    </section>
  );
}
