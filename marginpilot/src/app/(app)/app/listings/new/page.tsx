import { requireStore } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Alert, EmptyState, PageHeader, Panel, TextLink } from "@/components/ui/app";
import { LinkButton } from "@/components/ui/button";
import { getStorePolicies, loadStoreRules } from "@/lib/lister/store";
import { BulkForm } from "./bulk-form";

export const metadata = { title: "Add products" };

export default async function NewListingsPage() {
  const ctx = await requireStore();
  const supabase = await createClient();
  const [{ data: suppliers }, rules, policies, { data: jobs }] = await Promise.all([
    supabase.from("suppliers").select("id, name, adapter").eq("org_id", ctx.org.id).eq("wholesale_attested", true).order("created_at"),
    loadStoreRules(ctx.store.id),
    getStorePolicies(ctx.store.id),
    supabase
      .from("bulk_jobs")
      .select("id, status, total, succeeded, failed, mode, created_at")
      .eq("store_id", ctx.store.id)
      .order("created_at", { ascending: false })
      .limit(5),
  ]);
  const storeLabel = ctx.store.label ?? ctx.store.ebay_username ?? "Current store";

  return (
    <>
      <PageHeader
        title="Add products"
        description="Paste supplier links or CSV rows. Each product gets an AI-written title and description, an eBay category and a price at your target margin."
        actions={<TextLink href="/app/listings/suppliers">Manage suppliers</TextLink>}
      />
      <div className="grid gap-6">
        {!policies.ok && (
          <Alert tone="warning" title="Publishing needs your business policies">
            {policies.message}{" "}
            <TextLink href={`/app/stores/${ctx.store.id}/rules`}>Open store rules</TextLink>
          </Alert>
        )}
        {(suppliers ?? []).length === 0 ? (
          <EmptyState title="Add a supplier first" action={<LinkButton href="/app/listings/suppliers">Add a supplier</LinkButton>}>
            Products come from a wholesale supplier you&apos;ve confirmed a relationship with.
          </EmptyState>
        ) : (
          <Panel>
            <BulkForm suppliers={suppliers ?? []} floor={rules.minNetMarginPct} storeLabel={storeLabel} />
          </Panel>
        )}
        {(jobs ?? []).length > 0 && (
          <Panel title="Recent batches">
            <ul className="grid gap-2 text-sm">
              {(jobs ?? []).map((j) => (
                <li key={j.id} className="flex flex-wrap items-center justify-between gap-2">
                  <TextLink href={`/app/listings/jobs/${j.id}`}>
                    {new Date(j.created_at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
                  </TextLink>
                  <span className="text-ink-muted">
                    {j.total} items, {j.mode === "publish" ? "publish" : "drafts"}, {j.status}
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </div>
    </>
  );
}
