import Link from "next/link";
import { adminContext } from "@/lib/admin/server";
import { PageHeader, Panel } from "@/components/ui/app";
import { AdminSupplierForm } from "@/components/directory/admin-supplier-form";

export const metadata = { title: "Add directory supplier" };

export default async function NewDirectorySupplierPage() {
  await adminContext();
  const today = new Date().toISOString().slice(0, 10);
  return (
    <>
      <p className="mb-2 text-sm">
        <Link href="/admin/directory" className="text-accent underline underline-offset-2">
          Supplier directory
        </Link>
      </p>
      <PageHeader title="Add supplier" description="Only add wholesale suppliers you have checked yourself. Save as a draft until it's verified." />
      <Panel>
        <AdminSupplierForm today={today} />
      </Panel>
    </>
  );
}
