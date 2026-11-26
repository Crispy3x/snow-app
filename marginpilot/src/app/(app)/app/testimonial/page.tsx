import { Alert, PageHeader, Panel } from "@/components/ui/app";
import { Badge } from "@/components/ui/layout";
import { SubmitButton } from "@/components/ui/submit-button";
import { BRAND } from "@/config/brand";
import { requireUser } from "@/lib/auth";
import { todayIso } from "@/lib/proof-admin/rules";
import { createClient } from "@/lib/supabase/server";
import { withdrawTestimonial } from "./actions";
import { TestimonialSubmitForm } from "./submit-form";

export const metadata = { title: "Share your results" };

const STATUS = {
  pending: { label: "Waiting for review", tone: "amber" },
  approved: { label: "Published", tone: "accent" },
  rejected: { label: "Not used", tone: "neutral" },
} as const;

function formatDate(iso: string) {
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export default async function TestimonialPage() {
  const user = await requireUser("/app/testimonial");
  const supabase = await createClient();
  const { data } = await supabase
    .from("testimonials")
    .select("id, name, quote, store_type, given_on, status, photo_path, created_at")
    .eq("submitted_by", user.id)
    .eq("source", "customer")
    .order("created_at", { ascending: false });
  const mine = (data ?? []) as {
    id: string; name: string; quote: string; store_type: string; given_on: string;
    status: keyof typeof STATUS; photo_path: string | null; created_at: string;
  }[];

  return (
    <>
      <PageHeader
        title="Share your results"
        description={`If ${BRAND.name} has helped your store, you can send a short testimonial for our website.`}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Panel title="Your testimonial">
          <div className="mb-5">
            <Alert title="Reviewed before anything is shown">
              A person on our team reads every submission. Nothing appears on the website unless we approve it and you&apos;ve
              given permission. We may fix typos, but we won&apos;t change what you said. You can withdraw it at any time.
            </Alert>
          </div>
          <TestimonialSubmitForm today={todayIso()} defaultName={user.fullName ?? ""} />
        </Panel>

        <Panel title="Your submissions">
          {mine.length === 0 ? (
            <p className="text-sm text-ink-muted">You haven&apos;t sent one yet.</p>
          ) : (
            <ul className="space-y-4">
              {mine.map((t) => (
                <li key={t.id} className="border-b border-line pb-4 last:border-0 last:pb-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={STATUS[t.status].tone}>{STATUS[t.status].label}</Badge>
                    <span className="text-xs text-ink-muted">Sent {formatDate(t.created_at)}</span>
                  </div>
                  <p className="mt-2 break-words text-sm">&ldquo;{t.quote}&rdquo;</p>
                  <p className="mt-1 text-xs text-ink-muted">
                    {t.name} · {t.store_type}
                    {t.photo_path && " · photo attached"}
                  </p>
                  <form action={withdrawTestimonial} className="mt-2">
                    <input type="hidden" name="id" value={t.id} />
                    <SubmitButton variant="secondary" pendingText="Withdrawing…">
                      Withdraw<span className="sr-only"> testimonial sent {formatDate(t.created_at)}</span>
                    </SubmitButton>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}
