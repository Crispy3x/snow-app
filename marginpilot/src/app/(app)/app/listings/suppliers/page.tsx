import { canManage, requirePlan } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Alert, EmptyState, PageHeader, Panel, TextLink } from "@/components/ui/app";
import { Badge } from "@/components/ui/layout";
import { Button } from "@/components/ui/button";
import { AddSupplierForm, UploadPriceListForm } from "./supplier-forms";
import { removeSupplier } from "./actions";

export const metadata = { title: "Suppliers" };

type SupplierRow = {
  id: string;
  name: string;
  adapter: string;
  wholesale_attested: boolean;
  config: { row_count?: number; uploaded_at?: string; file_name?: string } | null;
  created_at: string;
  supplier_products: { count: number }[];
};

const ADAPTER_LABEL: Record<string, string> = { csv_feed: "Price list (CSV)", mock: "Mock supplier" };

export default async function SuppliersPage() {
  const ctx = await requirePlan();
  const supabase = await createClient();
  const { data } = await supabase
    .from("suppliers")
    .select("id, name, adapter, wholesale_attested, config, created_at, supplier_products(count)")
    .eq("org_id", ctx.org.id)
    .order("created_at");
  // config.rows can be large; only the summary fields are read below
  const suppliers = (data ?? []) as unknown as SupplierRow[];

  return (
    <>
      <PageHeader
        title="Suppliers"
        description="Wholesale sources you list from. eBay allows drop shipping only from wholesale suppliers, so retail stores and marketplaces can't be added."
        actions={<TextLink href="/app/listings/new">Add products</TextLink>}
      />
      <div className="grid gap-6">
        {suppliers.length === 0 ? (
          <EmptyState title="No suppliers yet">Add your wholesale supplier below. Upload their price list as a CSV, or use the mock supplier to try things out.</EmptyState>
        ) : (
          <ul className="grid gap-4" aria-label="Suppliers">
            {suppliers.map((s) => (
              <li key={s.id} className="rounded-lg border border-line bg-card p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h2 className="text-lg font-semibold">{s.name}</h2>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-muted">
                      <Badge>{ADAPTER_LABEL[s.adapter] ?? s.adapter}</Badge>
                      {s.wholesale_attested ? <Badge tone="accent">Wholesale confirmed</Badge> : <Badge tone="danger">Wholesale not confirmed</Badge>}
                      <span>{(s.supplier_products?.[0]?.count ?? 0).toLocaleString()} products listed from here</span>
                    </div>
                    {s.adapter === "csv_feed" && (
                      <p className="mt-2 text-sm text-ink-muted">
                        {s.config?.row_count
                          ? `Price list: ${s.config.row_count.toLocaleString()} rows${s.config.file_name ? ` from ${s.config.file_name}` : ""}, uploaded ${new Date(s.config.uploaded_at ?? s.created_at).toLocaleDateString("en-US", { dateStyle: "medium" })}.`
                          : "No price list uploaded yet."}{" "}
                        In bulk add, use links like <code className="rounded bg-paper px-1">csv:SKU123</code> or paste rows.
                      </p>
                    )}
                    {s.adapter === "mock" && (
                      <p className="mt-2 text-sm text-ink-muted">
                        Test links: <code className="rounded bg-paper px-1">mock:anything</code> or{" "}
                        <code className="rounded bg-paper px-1">https://mock-supplier.test/p/abc</code>.
                      </p>
                    )}
                  </div>
                  {canManage(ctx.role) && (
                    <form action={removeSupplier}>
                      <input type="hidden" name="supplierId" value={s.id} />
                      <Button type="submit" variant="ghost" aria-label={`Remove ${s.name}`}>
                        Remove
                      </Button>
                    </form>
                  )}
                </div>
                {s.adapter === "csv_feed" && (
                  <div className="mt-4 border-t border-line pt-4">
                    <UploadPriceListForm supplierId={s.id} name={s.name} />
                    <p className="mt-2 text-sm text-ink-muted">
                      Replacing the price list doesn&apos;t change live listings directly. Cost and stock changes show up as proposals in Price and stock.
                    </p>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        <Panel title="Add a supplier">
          <div className="grid gap-4">
            <Alert tone="info">
              Links from Amazon, Walmart, AliExpress, Temu and other retail stores are blocked. Buying from a retailer to ship to your buyer
              breaks eBay&apos;s drop shipping policy.
            </Alert>
            <AddSupplierForm />
          </div>
        </Panel>
      </div>
    </>
  );
}
