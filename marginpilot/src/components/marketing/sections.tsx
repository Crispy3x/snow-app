import { BRAND } from "@/config/brand";
import { AI_TOOLS, COURSE_MODULES, FAQ, FEATURES, HOW_IT_WORKS } from "@/content/marketing";
import { LinkButton } from "@/components/ui/button";
import { Badge, Card, Container, Section } from "@/components/ui/layout";
import { icons } from "@/components/ui/icons";

/* ---------- Hero ---------- */

const SAMPLE_ROWS = [
  { title: "Stainless garlic press, heavy duty", price: "24.99", cost: "9.10", margin: "31%", status: "Active" },
  { title: "Silicone baking mat set of 3", price: "18.49", cost: "6.75", margin: "28%", status: "Active" },
  { title: "Bamboo drawer organizer, 6 slot", price: "29.95", cost: "13.40", margin: "22%", status: "Below floor" },
  { title: "Magnetic knife strip, 16 inch", price: "21.00", cost: "7.95", margin: "30%", status: "Draft" },
];

export function Hero() {
  return (
    <section aria-labelledby="hero-heading" className="border-b border-line">
      <Container className="grid items-center gap-12 py-16 sm:py-20 lg:grid-cols-2">
        <div>
          <h1 id="hero-heading" className="text-4xl font-semibold leading-tight sm:text-5xl">
            {BRAND.tagline}
          </h1>
          <p className="mt-5 max-w-xl text-lg text-ink-muted">
            {BRAND.name} lists products in bulk, holds every price above your margin floor, keeps stock in
            sync with your wholesale supplier and queues orders, so the store runs on rules you set once.
            A video course covers the selling side.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <LinkButton href="/signup" size="lg">
              Start free trial
            </LinkButton>
            <LinkButton href="/#software" size="lg" variant="secondary">
              See how it works
            </LinkButton>
          </div>
        </div>

        <figure className="min-w-0 rounded-lg border border-line bg-card">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <figcaption className="font-display text-sm font-semibold">Listings</figcaption>
            <Badge tone="amber">Sample data</Badge>
          </div>
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Sample listings table, scrolls sideways">
            <table className="w-full min-w-[480px] text-left text-sm">
              <caption className="sr-only">Sample listings table, not real store data</caption>
              <thead className="text-ink-muted">
                <tr className="border-b border-line">
                  <th scope="col" className="px-4 py-2 font-medium">Title</th>
                  <th scope="col" className="px-4 py-2 font-medium text-right">Price</th>
                  <th scope="col" className="px-4 py-2 font-medium text-right">Cost</th>
                  <th scope="col" className="px-4 py-2 font-medium text-right">Net margin</th>
                  <th scope="col" className="px-4 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {SAMPLE_ROWS.map((r) => (
                  <tr key={r.title} className="border-b border-line last:border-0">
                    <td className="px-4 py-3">{r.title}</td>
                    <td className="px-4 py-3 text-right tabular-nums">${r.price}</td>
                    <td className="px-4 py-3 text-right tabular-nums">${r.cost}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{r.margin}</td>
                    <td className="px-4 py-3">
                      <Badge tone={r.status === "Below floor" ? "danger" : r.status === "Draft" ? "neutral" : "accent"}>
                        {r.status}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t border-line px-4 py-3 text-xs text-ink-muted">
            Margin floor 25%. The row below the floor stays unpublished until its price is fixed.
          </p>
        </figure>
      </Container>
    </section>
  );
}

/* ---------- How it works ---------- */

export function HowItWorks() {
  return (
    <Section id="how-it-works" eyebrow="How it works" title="Three steps, then it runs on rules">
      <ol className="grid gap-6 md:grid-cols-3">
        {HOW_IT_WORKS.map((step, i) => (
          <li key={step.title}>
            <Card className="h-full">
              <div className="flex items-center gap-3 text-accent">
                {icons[step.icon]}
                <span className="text-sm font-semibold">Step {i + 1}</span>
              </div>
              <h3 className="mt-4 text-xl font-semibold">{step.title}</h3>
              <p className="mt-2 text-ink-muted">{step.body}</p>
            </Card>
          </li>
        ))}
      </ol>
    </Section>
  );
}

/* ---------- Feature grids ---------- */

function IconCardGrid({ items }: { items: { icon: keyof typeof icons; title: string; body: string }[] }) {
  return (
    <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((f) => (
        <li key={f.title}>
          <Card className="h-full">
            <div className="inline-flex rounded-md bg-accent-soft p-2 text-accent">{icons[f.icon]}</div>
            <h3 className="mt-4 text-lg font-semibold">{f.title}</h3>
            <p className="mt-2 text-ink-muted">{f.body}</p>
          </Card>
        </li>
      ))}
    </ul>
  );
}

export function SoftwareFeatures() {
  return (
    <Section
      id="software"
      eyebrow="Software"
      title="The work of running a store, set as rules"
      intro="Each store gets its own rules: minimum net margin, sale discount, ad rates by price tier, handling time, shipping regions and minimum price."
      className="bg-card border-y border-line"
    >
      <IconCardGrid items={FEATURES} />
    </Section>
  );
}

export function AiToolsSection() {
  return (
    <Section
      id="ai-tools"
      eyebrow="AI tools"
      title="AI that drafts, and waits for your yes"
      intro="Every AI result appears as a draft you approve. Usage counts against your plan's AI credits."
    >
      <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {AI_TOOLS.map((t) => (
          <li key={t.title}>
            <Card className="h-full p-5">
              <div className="text-accent">{icons[t.icon]}</div>
              <h3 className="mt-3 text-base font-semibold">{t.title}</h3>
              <p className="mt-2 text-sm text-ink-muted">{t.body}</p>
            </Card>
          </li>
        ))}
      </ul>
    </Section>
  );
}

/* ---------- Course ---------- */

export function CourseSection() {
  return (
    <Section
      id="course"
      eyebrow="Course"
      title="The selling side, in six modules"
      intro="Video lessons with downloadable worksheets. Included with the Professional and Mentorship plans."
      className="bg-card border-y border-line"
    >
      <ol className="grid gap-4 md:grid-cols-2">
        {COURSE_MODULES.map((m, i) => (
          <li key={m.title} className="flex gap-4 rounded-lg border border-line bg-paper p-5">
            <span
              aria-hidden="true"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-ink font-display font-semibold text-white"
            >
              {i + 1}
            </span>
            <div>
              <h3 className="text-lg font-semibold">
                <span className="sr-only">Module {i + 1}: </span>
                {m.title}
              </h3>
              <p className="mt-1 text-ink-muted">{m.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </Section>
  );
}

/* ---------- FAQ ---------- */

export function FaqSection() {
  return (
    <Section id="faq" eyebrow="FAQ" title="Questions sellers ask" className="bg-card border-y border-line">
      <div className="max-w-3xl divide-y divide-line rounded-lg border border-line bg-paper">
        {FAQ.map((item) => (
          <details key={item.q} className="group p-5">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold">
              {item.q}
              <span aria-hidden="true" className="text-xl text-accent group-open:rotate-45 transition-transform">
                +
              </span>
            </summary>
            <p className="mt-3 text-ink-muted">{item.a}</p>
          </details>
        ))}
      </div>
    </Section>
  );
}

/* ---------- Final CTA ---------- */

export function FinalCta() {
  return (
    <section aria-labelledby="cta-heading" className="py-16 sm:py-20">
      <Container>
        <div className="rounded-lg bg-ink px-6 py-12 text-center text-white sm:px-12">
          <h2 id="cta-heading" className="text-3xl font-semibold sm:text-4xl">
            Set the rules once. Let the store follow them.
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-white/85">
            Connect a store, set your margin floor and list your first batch today.
          </p>
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <LinkButton href="/signup" size="lg" variant="amber">
              Start free trial
            </LinkButton>
            <LinkButton href="/#pricing" size="lg" variant="onDark">
              Compare plans
            </LinkButton>
          </div>
        </div>
      </Container>
    </section>
  );
}
