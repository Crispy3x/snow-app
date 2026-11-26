import { requireStore } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/app";
import { AI_TOOLS } from "@/config/ai";
import { loadStoreRules } from "@/lib/lister/store";
import { ListingWriter } from "./writer-client";

export const metadata = { title: "Listing writer" };

export default async function ListingWriterPage() {
  const ctx = await requireStore();
  const supabase = await createClient();
  const [{ data: suppliers }, rules] = await Promise.all([
    supabase.from("suppliers").select("id, name").eq("org_id", ctx.org.id).eq("wholesale_attested", true).order("created_at"),
    loadStoreRules(ctx.store.id),
  ]);
  return (
    <>
      <PageHeader
        title="Listing writer"
        description={`Turn a supplier link or raw supplier text into an eBay-ready title, description and item specifics, with brand (VeRO) warnings. ${AI_TOOLS.listing_writer.credits} AI credits per draft.`}
      />
      <ListingWriter suppliers={suppliers ?? []} rules={rules} />
    </>
  );
}
