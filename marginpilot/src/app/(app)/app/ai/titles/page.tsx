import { requireStore } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { EmptyState, PageHeader } from "@/components/ui/app";
import { Button, LinkButton } from "@/components/ui/button";
import { TextInput } from "@/components/ui/form";
import { MAX_TITLE_BATCH } from "@/lib/lister/text";
import { TitleOptimizer } from "./titles-client";

export const metadata = { title: "Title optimizer" };

export default async function TitlesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireStore();
  const q = typeof sp.q === "string" ? sp.q.replace(/[%,()*\\]/g, " ").trim().slice(0, 80) : "";
  const supabase = await createClient();
  let query = supabase
    .from("listings")
    .select("id, title, sku, status")
    .eq("store_id", ctx.store.id)
    .in("status", ["draft", "active", "out_of_stock", "blocked_margin"])
    .order("views", { ascending: true })
    .limit(200);
  if (q) query = query.or(`title.ilike.%${q}%,sku.ilike.%${q}%`);
  const only = typeof sp.listing === "string" && /^[0-9a-f-]{36}$/i.test(sp.listing) ? sp.listing : null;
  if (only) query = query.eq("id", only);
  const { data } = await query;
  const listings = data ?? [];

  return (
    <>
      <PageHeader
        title="Title optimizer"
        description={`Pick up to ${MAX_TITLE_BATCH} listings and get search-optimised titles. Approve row by row; live listings are updated on eBay and each change is logged so it can be undone.`}
      />
      <form method="get" role="search" className="mb-4 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <TextInput id="q" label="Search title or SKU" type="search" defaultValue={q} />
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>
      {listings.length === 0 ? (
        <EmptyState title={q ? "No listings match" : "No listings yet"} action={!q ? <LinkButton href="/app/listings/new">Add products</LinkButton> : undefined}>
          {q ? "Try a different search." : "Add products first, then come back to sharpen their titles."}
        </EmptyState>
      ) : (
        <TitleOptimizer listings={listings} maxBatch={MAX_TITLE_BATCH} />
      )}
    </>
  );
}
