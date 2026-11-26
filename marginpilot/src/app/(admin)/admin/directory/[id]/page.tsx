import Link from "next/link";
import { notFound } from "next/navigation";
import { adminContext, formatDateTime, userEmails } from "@/lib/admin/server";
import { Alert, PageHeader, Panel } from "@/components/ui/app";
import { buttonClasses } from "@/components/ui/button";
import { ConfirmDelete } from "@/components/course/admin/confirm-delete";
import { AdminSupplierForm } from "@/components/directory/admin-supplier-form";
import { DETAIL_COLUMNS, formatDay, type DirectorySupplier } from "@/lib/directory/types";
import { deleteDirectorySupplier, setDirectoryStatus } from "../actions";

export const metadata = { title: "Edit directory supplier" };

export default async function EditDirectorySupplierPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string; publish_error?: string }>;
}) {
  const { db } = await adminContext();
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { data } = await db.from("directory_suppliers").select(DETAIL_COLUMNS).eq("id", id).maybeSingle();
  if (!data) notFound();
  const s = data as unknown as DirectorySupplier;
  const [emails, { count: addedBy }] = await Promise.all([
    userEmails(db, [s.verified_by]),
    db.from("suppliers").select("id", { count: "exact", head: true }).eq("config->>directory_id", s.id),
  ]);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <p className="mb-2 text-sm">
        <Link href="/admin/directory" className="text-accent underline underline-offset-2">
          Supplier directory
        </Link>
      </p>
      <PageHeader
        title={s.name}
        description={`Status: ${s.status}. Last updated ${formatDateTime(s.updated_at)}.${s.verified_on ? ` Verified ${formatDay(s.verified_on)}${s.verified_by ? ` by ${emails.get(s.verified_by) ?? "an admin"}` : ""}.` : ""} Added by ${addedBy ?? 0} workspace${addedBy === 1 ? "" : "s"}.`}
        actions={
          <form action={setDirectoryStatus} className="flex flex-wrap gap-2">
            <input type="hidden" name="id" value={s.id} />
            {s.status !== "published" && (
              <button type="submit" name="status" value="published" className={buttonClasses("primary")}>
                Publish
              </button>
            )}
            {s.status === "published" && (
              <button type="submit" name="status" value="draft" className={buttonClasses("secondary")}>
                Unpublish
              </button>
            )}
            {s.status !== "archived" ? (
              <button type="submit" name="status" value="archived" className={buttonClasses("ghost")}>
                Archive
              </button>
            ) : (
              <button type="submit" name="status" value="draft" className={buttonClasses("ghost")}>
                Restore as draft
              </button>
            )}
          </form>
        }
      />
      <div className="grid gap-6">
        {sp.created && <Alert tone="success">Supplier created.</Alert>}
        {sp.publish_error && (
          <Alert tone="danger" title="Not published">
            Fix the record first: it needs a verified-on date and valid details. Set the status to Published in the form below to see what&apos;s missing.
          </Alert>
        )}
        <Panel>
          <AdminSupplierForm supplier={s} today={today} />
        </Panel>
        {s.status !== "published" && (
          <ConfirmDelete
            action={deleteDirectorySupplier}
            id={s.id}
            summary="Delete this supplier"
            warning="The entry is removed from the directory and from sellers' favourites. Suppliers that workspaces already added stay in their accounts."
            confirmText="Delete supplier"
          />
        )}
      </div>
    </>
  );
}
