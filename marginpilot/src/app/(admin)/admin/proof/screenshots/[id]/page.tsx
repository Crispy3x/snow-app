import { notFound } from "next/navigation";
import { Alert, PageHeader, Panel, TextLink } from "@/components/ui/app";
import { isUuid } from "@/lib/admin/flag-rules";
import { adminContext, formatDateTime, userEmails } from "@/lib/admin/server";
import { publicProofUrl } from "@/lib/proof";
import { normalizeBoxes } from "@/lib/proof-admin/redaction";
import { todayIso } from "@/lib/proof-admin/rules";
import { BUCKETS } from "@/lib/proof-admin/storage";
import { ActionButton, StatusBadge } from "../../proof-ui";
import { deleteScreenshot, rejectScreenshot, unpublishScreenshot } from "../../actions";
import { DetailsForm } from "./details-form";
import { RedactionTool } from "./redaction-tool";

export const metadata = { title: "Redact screenshot" };

export default async function ScreenshotPage({ params }: { params: Promise<{ id: string }> }) {
  const { db } = await adminContext();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const { data } = await db.from("proof_screenshots").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();
  const s = data as {
    id: string; original_path: string; public_image_path: string | null; redactions: unknown; caption: string; store_label: string;
    range_start: string; range_end: string; captured_on: string; image_width: number | null; image_height: number | null;
    status: "pending" | "approved" | "rejected"; uploaded_by: string | null; reviewed_by: string | null; reviewed_at: string | null; created_at: string;
  };

  // Short-lived private link to the unredacted original, for the admin's browser only.
  const [{ data: signed }, emails] = await Promise.all([
    db.storage.from(BUCKETS.originals).createSignedUrl(s.original_path, 600),
    userEmails(db, [s.uploaded_by, s.reviewed_by]),
  ]);
  const width = s.image_width ?? 0;
  const height = s.image_height ?? 0;
  let boxes: ReturnType<typeof normalizeBoxes> = [];
  try {
    boxes = normalizeBoxes(s.redactions, width, height);
  } catch {
    boxes = [];
  }

  return (
    <>
      <p className="mb-2 text-sm">
        <TextLink href="/admin/proof">Back to the proof queue</TextLink>
      </p>
      <PageHeader title="Redact and review" description={s.caption} actions={<StatusBadge status={s.status} />} />

      {s.status === "approved" && s.public_image_path && (
        <div className="mb-6">
          <Alert tone="success" title="Published">
            This screenshot is live in the Results section.{" "}
            <a href={publicProofUrl(s.public_image_path)} target="_blank" rel="noreferrer" className="font-medium underline underline-offset-2">
              View the published (redacted) image<span className="sr-only"> (opens in a new tab)</span>
            </a>
          </Alert>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0">
          {!signed?.signedUrl || !width || !height ? (
            <Alert tone="danger" title="The original can't be opened">
              The file is missing or its size is unknown. Delete this item and upload the screenshot again.
            </Alert>
          ) : (
            <RedactionTool id={s.id} src={signed.signedUrl} width={width} height={height} initialBoxes={boxes} status={s.status} />
          )}
        </div>

        <div className="space-y-6">
          <Panel title="Details">
            <DetailsForm
              today={todayIso()}
              shot={{ id: s.id, caption: s.caption, store_label: s.store_label, range_start: s.range_start, range_end: s.range_end, captured_on: s.captured_on }}
            />
          </Panel>
          <Panel title="Status">
            <dl className="space-y-2 text-sm">
              <div>
                <dt className="text-ink-muted">Uploaded</dt>
                <dd>
                  {formatDateTime(s.created_at)}
                  {s.uploaded_by && <> by {emails.get(s.uploaded_by) ?? "admin"}</>}
                </dd>
              </div>
              {s.reviewed_at && (
                <div>
                  <dt className="text-ink-muted">Last reviewed</dt>
                  <dd>
                    {formatDateTime(s.reviewed_at)}
                    {s.reviewed_by && <> by {emails.get(s.reviewed_by) ?? "admin"}</>}
                  </dd>
                </div>
              )}
            </dl>
            <div className="mt-4 flex flex-wrap gap-2">
              {s.status === "approved" && <ActionButton id={s.id} action={unpublishScreenshot}>Unpublish</ActionButton>}
              {s.status !== "rejected" && <ActionButton id={s.id} action={rejectScreenshot} danger>Reject</ActionButton>}
              {s.status === "rejected" && <ActionButton id={s.id} action={deleteScreenshot} danger>Delete permanently</ActionButton>}
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}
