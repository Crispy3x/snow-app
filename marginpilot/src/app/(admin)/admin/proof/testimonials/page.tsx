import Link from "next/link";
import { EmptyState, PageHeader, Panel } from "@/components/ui/app";
import { Badge } from "@/components/ui/layout";
import { adminContext, formatDate } from "@/lib/admin/server";
import { publicProofUrl } from "@/lib/proof";
import { todayIso } from "@/lib/proof-admin/rules";
import { BUCKETS, signedUrls } from "@/lib/proof-admin/storage";
import { ActionButton, MoveButtons, ProofTabs, StatusBadge, pendingCounts } from "../proof-ui";
import { approveTestimonial, deleteTestimonial, moveTestimonial, rejectTestimonial, unpublishTestimonial } from "./actions";
import { TestimonialForm } from "./testimonial-form";

export const metadata = { title: "Testimonials" };

type Row = {
  id: string;
  name: string;
  quote: string;
  store_type: string;
  photo_path: string | null;
  photo_public_path: string | null;
  permission_given: boolean;
  given_on: string;
  source: "admin" | "customer";
  status: "pending" | "approved" | "rejected";
  sort_order: number;
  created_at: string;
};

const GROUPS = [
  { status: "pending", title: "Waiting for review", empty: "Nothing to review. Customer submissions from Share your results land here." },
  { status: "approved", title: "Published", empty: "Nothing published. The Results section stays hidden until something is approved." },
  { status: "rejected", title: "Rejected", empty: "No rejected testimonials." },
] as const;

export default async function TestimonialsAdminPage() {
  const { db } = await adminContext();
  const [{ data, error }, pending] = await Promise.all([
    db
      .from("testimonials")
      .select("id, name, quote, store_type, photo_path, photo_public_path, permission_given, given_on, source, status, sort_order, created_at")
      .order("sort_order", { ascending: true })
      .order("given_on", { ascending: false })
      .limit(500),
    pendingCounts(db),
  ]);
  const rows = (data ?? []) as Row[];
  const photos = await signedUrls(db, BUCKETS.uploads, rows.filter((r) => !r.photo_public_path).map((r) => r.photo_path), 600);

  return (
    <>
      <PageHeader
        title="Proof queue"
        description="Real testimonials only, shown publicly once approved and only with the person's permission. Never write or edit one to say something the person didn't."
      />
      <ProofTabs current="testimonials" pending={pending} />
      {error && <p role="alert" className="mb-4 text-sm font-medium text-danger">Couldn&apos;t load testimonials: {error.message}</p>}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-8">
          {GROUPS.map((g) => {
            const items = rows.filter((r) => r.status === g.status);
            return (
              <section key={g.status} aria-labelledby={`tg-${g.status}`}>
                <h2 id={`tg-${g.status}`} className="mb-3 text-lg font-semibold">
                  {g.title} <span className="text-ink-muted">({items.length})</span>
                </h2>
                {items.length === 0 ? (
                  <EmptyState title="None">{g.empty}</EmptyState>
                ) : (
                  <ul className="space-y-4">
                    {items.map((t, i) => {
                      const photo = t.photo_public_path ? publicProofUrl(t.photo_public_path) : t.photo_path ? photos.get(t.photo_path) : undefined;
                      return (
                        <li key={t.id} className="rounded-lg border border-line bg-card p-4">
                          <div className="flex flex-wrap items-center gap-2">
                            <StatusBadge status={t.status} />
                            <Badge tone="neutral">{t.source === "customer" ? "Customer submitted" : "Added by admin"}</Badge>
                            {t.permission_given ? <Badge tone="accent">Permission given</Badge> : <Badge tone="danger">No permission</Badge>}
                          </div>
                          <div className="mt-3 flex gap-3">
                            {photo && (
                              // eslint-disable-next-line @next/next/no-img-element -- signed or public storage URL
                              <img src={photo} alt={`Photo of ${t.name}`} width={48} height={48} className="h-12 w-12 shrink-0 rounded-full object-cover" />
                            )}
                            <blockquote className="min-w-0">
                              <p className="break-words">&ldquo;{t.quote}&rdquo;</p>
                              <footer className="mt-1 text-sm text-ink-muted">
                                <span className="font-semibold text-ink">{t.name}</span> · {t.store_type} · {formatDate(t.given_on)}
                              </footer>
                            </blockquote>
                          </div>
                          <div className="mt-4 flex flex-wrap items-center gap-2">
                            {t.status !== "approved" &&
                              (t.permission_given ? (
                                <ActionButton id={t.id} action={approveTestimonial} variant="primary">
                                  Approve and publish
                                </ActionButton>
                              ) : (
                                <p className="text-sm text-ink-muted">Can&apos;t approve without permission.</p>
                              ))}
                            {t.status === "approved" && <ActionButton id={t.id} action={unpublishTestimonial}>Unpublish</ActionButton>}
                            {t.status !== "rejected" && <ActionButton id={t.id} action={rejectTestimonial} danger>Reject</ActionButton>}
                            {t.status === "rejected" && <ActionButton id={t.id} action={deleteTestimonial} danger>Delete permanently</ActionButton>}
                            <Link href={`/admin/proof/testimonials/${t.id}`} className="min-h-10 px-2 py-2 text-sm font-medium text-accent underline underline-offset-2 hover:text-accent-strong">
                              Edit<span className="sr-only"> testimonial from {t.name}</span>
                            </Link>
                            <div className="ml-auto">
                              <MoveButtons id={t.id} label={`testimonial from ${t.name}`} action={moveTestimonial} first={i === 0} last={i === items.length - 1} />
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            );
          })}
        </div>

        <Panel title="Add a testimonial" description="For quotes you received directly, with permission.">
          <TestimonialForm today={todayIso()} />
        </Panel>
      </div>
    </>
  );
}
