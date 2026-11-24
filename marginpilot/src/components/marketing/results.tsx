import { BRAND } from "@/config/brand";
import { getApprovedProof, publicProofUrl } from "@/lib/proof";
import { Container } from "@/components/ui/layout";

function formatDate(iso: string) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Results: only approved, real proof from the database. Each sub-section hides
 * when it has nothing approved, and the whole section hides when both are empty.
 * Nothing here is ever seeded or generated.
 */
export async function ResultsSection() {
  const { screenshots, testimonials } = await getApprovedProof();
  if (screenshots.length === 0 && testimonials.length === 0) return null;

  return (
    <section id="results" aria-labelledby="results-heading" className="scroll-mt-20 py-16 sm:py-20">
      <Container>
        <div className="max-w-2xl">
          <p className="mb-2 text-sm font-semibold uppercase tracking-wide text-accent">Results</p>
          <h2 id="results-heading" className="text-3xl font-semibold sm:text-4xl">
            From sellers using {BRAND.name}
          </h2>
          <p className="mt-4 rounded-md border border-amber bg-amber-soft px-4 py-3 text-sm font-medium text-ink">
            {BRAND.resultsDisclaimer}
          </p>
        </div>

        {screenshots.length > 0 && (
          <div className="mt-10">
            <h3 className="text-xl font-semibold">Seller Hub screenshots</h3>
            <ul className="mt-4 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {screenshots.map((s) => (
                <li key={s.id}>
                  <figure className="h-full overflow-hidden rounded-lg border border-line bg-card">
                    {/* eslint-disable-next-line @next/next/no-img-element -- user-uploaded, variable dimensions */}
                    <img
                      src={publicProofUrl(s.public_image_path)}
                      alt={`eBay Seller Hub screenshot: ${s.caption}`}
                      width={s.image_width ?? undefined}
                      height={s.image_height ?? undefined}
                      loading="lazy"
                      className="h-auto w-full border-b border-line"
                    />
                    <figcaption className="p-4 text-sm">
                      <p className="font-medium">{s.caption}</p>
                      <p className="mt-1 text-ink-muted">
                        {s.store_label} · Period shown: {formatDate(s.range_start)} to {formatDate(s.range_end)}
                      </p>
                      <p className="text-ink-muted">Captured {formatDate(s.captured_on)}</p>
                    </figcaption>
                  </figure>
                </li>
              ))}
            </ul>
          </div>
        )}

        {testimonials.length > 0 && (
          <div className="mt-12">
            <h3 className="text-xl font-semibold">What sellers say</h3>
            <ul className="mt-4 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {testimonials.map((t) => (
                <li key={t.id}>
                  <figure className="flex h-full flex-col rounded-lg border border-line bg-card p-6">
                    <blockquote className="flex-1 text-ink">
                      <p>&ldquo;{t.quote}&rdquo;</p>
                    </blockquote>
                    <figcaption className="mt-4 flex items-center gap-3 text-sm">
                      {t.photo_public_path && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={publicProofUrl(t.photo_public_path)}
                          alt=""
                          width={40}
                          height={40}
                          className="h-10 w-10 rounded-full object-cover"
                        />
                      )}
                      <span>
                        <span className="block font-semibold">{t.name}</span>
                        <span className="text-ink-muted">
                          {t.store_type} · {formatDate(t.given_on)}
                        </span>
                      </span>
                    </figcaption>
                  </figure>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Container>
    </section>
  );
}
