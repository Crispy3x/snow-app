import { notFound } from "next/navigation";
import { PageHeader, Panel, TextLink } from "@/components/ui/app";
import { isUuid } from "@/lib/admin/flag-rules";
import { adminContext, formatDateTime, userEmails } from "@/lib/admin/server";
import { publicProofUrl } from "@/lib/proof";
import { todayIso } from "@/lib/proof-admin/rules";
import { BUCKETS, signedUrls } from "@/lib/proof-admin/storage";
import { StatusBadge } from "../../proof-ui";
import { TestimonialForm } from "../testimonial-form";

export const metadata = { title: "Edit testimonial" };

export default async function EditTestimonialPage({ params }: { params: Promise<{ id: string }> }) {
  const { db } = await adminContext();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const { data } = await db.from("testimonials").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();
  const t = data as {
    id: string; name: string; quote: string; store_type: string; photo_path: string | null; photo_public_path: string | null;
    permission_given: boolean; given_on: string; source: string; submitted_by: string | null; status: string;
    reviewed_by: string | null; reviewed_at: string | null; created_at: string;
  };
  const [emails, photos] = await Promise.all([
    userEmails(db, [t.submitted_by, t.reviewed_by]),
    signedUrls(db, BUCKETS.uploads, [t.photo_path], 600),
  ]);
  const photo = t.photo_public_path ? publicProofUrl(t.photo_public_path) : t.photo_path ? photos.get(t.photo_path) : undefined;

  return (
    <>
      <p className="mb-2 text-sm">
        <TextLink href="/admin/proof/testimonials">Back to testimonials</TextLink>
      </p>
      <PageHeader title={`Testimonial from ${t.name}`} description="Fix typos or formatting only. Changing what someone said needs their agreement." />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <Panel>
          <TestimonialForm
            today={todayIso()}
            initial={{
              id: t.id,
              name: t.name,
              quote: t.quote,
              store_type: t.store_type,
              given_on: t.given_on,
              permission_given: t.permission_given,
              has_photo: !!t.photo_path,
              status: t.status,
            }}
          />
        </Panel>
        <Panel title="Record">
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-ink-muted">Status</dt>
              <dd className="mt-1"><StatusBadge status={t.status} /></dd>
            </div>
            <div>
              <dt className="text-ink-muted">Source</dt>
              <dd className="break-all">
                {t.source === "customer" ? `Customer: ${t.submitted_by ? (emails.get(t.submitted_by) ?? "unknown user") : "account deleted"}` : "Added by admin"}
              </dd>
            </div>
            <div>
              <dt className="text-ink-muted">Received</dt>
              <dd>{formatDateTime(t.created_at)}</dd>
            </div>
            {t.reviewed_at && (
              <div>
                <dt className="text-ink-muted">Last reviewed</dt>
                <dd>
                  {formatDateTime(t.reviewed_at)}
                  {t.reviewed_by && <> by {emails.get(t.reviewed_by) ?? "admin"}</>}
                </dd>
              </div>
            )}
            {photo && (
              <div>
                <dt className="text-ink-muted">Photo</dt>
                <dd className="mt-1">
                  {/* eslint-disable-next-line @next/next/no-img-element -- signed or public storage URL */}
                  <img src={photo} alt={`Photo of ${t.name}`} width={96} height={96} className="h-24 w-24 rounded-full object-cover" />
                </dd>
              </div>
            )}
          </dl>
        </Panel>
      </div>
    </>
  );
}
