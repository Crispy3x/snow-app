import { LinkButton } from "@/components/ui/button";
import { getPlan } from "@/config/plans";

/** What the Mentorship plan adds, for workspaces on another plan. */
export function LockedMentorship() {
  const plan = getPlan("mentorship");
  const professional = getPlan("professional");
  const extras = (plan?.features ?? []).filter((f) => !(professional?.features ?? []).includes(f) && !/^Up to|team seats|AI credits|Everything in/.test(f));
  return (
    <section aria-labelledby="mentorship-locked-heading" className="rounded-lg border border-amber bg-amber-soft p-5">
      <h2 id="mentorship-locked-heading" className="text-lg font-semibold">
        The mentorship hub is part of the {plan?.name ?? "Mentorship"} plan
      </h2>
      <p className="mt-2 max-w-2xl text-sm">{plan?.blurb}</p>
      <ul className="mt-3 grid list-disc gap-1 pl-5 text-sm">
        {extras.map((f) => (
          <li key={f}>{f}</li>
        ))}
      </ul>
      <div className="mt-4">
        <LinkButton href="/app/billing?reason=mentorship">See plans</LinkButton>
      </div>
    </section>
  );
}
