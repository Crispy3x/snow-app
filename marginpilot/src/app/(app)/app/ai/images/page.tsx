import { requireStore } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/app";
import { ImageCleaner } from "./images-client";

export const metadata = { title: "Image cleaner" };

export default async function ImagesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireStore();
  const supabase = await createClient();
  const { data } = await supabase
    .from("listings")
    .select("id, title, images")
    .eq("store_id", ctx.store.id)
    .neq("status", "ended")
    .order("created_at", { ascending: false })
    .limit(200);
  const listings = ((data ?? []) as { id: string; title: string; images: string[] | null }[])
    .map((l) => ({ id: l.id, title: l.title, images: l.images ?? [] }))
    .filter((l) => l.images.length > 0);
  const initial = typeof sp.listing === "string" && listings.some((l) => l.id === sp.listing) ? sp.listing : "";

  return (
    <>
      <PageHeader
        title="Image cleaner"
        description="Finds sale banners, coupons, watermarks and stamped logos on supplier photos. Edge overlays are cropped off and overlays on plain backgrounds are filled. Anything else is flagged, never guessed. You approve every change."
      />
      <ImageCleaner listings={listings} initialListing={initial} />
    </>
  );
}
