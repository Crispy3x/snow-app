import { notFound } from "next/navigation";
import { getAppContext } from "@/lib/auth";
import { Alert, PageHeader, Panel, TextLink } from "@/components/ui/app";
import { listingCost, loadListing } from "@/lib/lister/publish";
import { loadStoreRules, POLICIES_MISSING_MESSAGE } from "@/lib/lister/store";
import { createClient } from "@/lib/supabase/server";
import { ListingStatusBadge } from "../_components/status-badge";
import { EndButton, ListingEditor, PublishButton } from "./listing-editor";

export const metadata = { title: "Listing" };

export default async function ListingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ price?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const suggested = Number(sp.price);
  const suggestedPrice = Number.isFinite(suggested) && suggested > 0 && suggested < 100000 ? Math.round(suggested * 100) / 100 : null;
  const ctx = await getAppContext();
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const listing = await loadListing(id, ctx.org.id);
  if (!listing) notFound();
  const rules = await loadStoreRules(listing.store_id);
  const supabase = await createClient();
  const { data: extra } = await supabase.from("listings").select("vero_risk, vero_flags").eq("id", listing.id).maybeSingle();
  const vero = { risk: (extra?.vero_risk as string | null) ?? null, flags: (extra?.vero_flags as string[] | null) ?? [] };
  const cost = listing.supplier_products ? listingCost(listing) : null;
  const isDraft = ["draft", "error", "blocked_margin"].includes(listing.status);
  const images = listing.images ?? [];

  return (
    <>
      <PageHeader
        title={listing.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <ListingStatusBadge status={listing.status} />
            <span className="font-mono text-xs">{listing.sku}</span>
            {listing.ebay_listing_id && <span className="text-sm">eBay item {listing.ebay_listing_id}</span>}
          </span>
        }
        actions={<TextLink href="/app/listings">All listings</TextLink>}
      />
      <div className="grid gap-6">
        {listing.last_error && listing.status !== "active" && (
          <Alert tone={listing.status === "blocked_margin" || listing.status === "error" ? "danger" : "warning"}>
            {listing.last_error}
            {listing.last_error === POLICIES_MISSING_MESSAGE && (
              <>
                {" "}
                <TextLink href={`/app/stores/${listing.store_id}/rules`}>Open store rules</TextLink>
              </>
            )}
          </Alert>
        )}
        {vero.risk && vero.risk !== "none" && (
          <Alert tone={vero.risk === "high" ? "danger" : "warning"} title={vero.risk === "high" ? "Brand (VeRO) warning" : "Check brand wording"}>
            <ul className="list-disc pl-5">
              {vero.flags.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </Alert>
        )}

        {suggestedPrice !== null && (
          <Alert tone="info" title="Suggested price filled in">
            The pricing advisor suggested ${suggestedPrice.toFixed(2)}. Check the margin below, then save to apply it.
          </Alert>
        )}
        <Panel title="Details">
          <ListingEditor
            rules={rules}
            listing={{
              id: listing.id,
              title: listing.title,
              description: listing.description ?? "",
              price: suggestedPrice ?? Number(listing.price),
              quantity: listing.quantity,
              status: listing.status,
              linkedCost: cost ? { cost: cost.supplierCost, shipping: cost.supplierShipping ?? 0 } : null,
              manualCost: listing.manual_cost !== null ? Number(listing.manual_cost) : null,
              manualShipping: listing.manual_shipping_cost !== null ? Number(listing.manual_shipping_cost) : null,
            }}
          />
          {cost && <p className="mt-4 text-sm text-ink-muted">Cost comes from the supplier ({listing.supplier_products?.title ?? "linked product"}) and updates with the price and stock monitor.</p>}
        </Panel>

        <Panel title="Photos" actions={<TextLink href={`/app/ai/images?listing=${listing.id}`}>Clean photos</TextLink>}>
          {images.length === 0 ? (
            <p className="text-sm text-ink-muted">No photos. eBay needs at least one to publish.</p>
          ) : (
            <ul className="grid grid-cols-3 gap-3 sm:grid-cols-6">
              {images.map((src, i) => (
                <li key={src + i}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt={`Photo ${i + 1} of ${listing.title}`} className="aspect-square w-full rounded border border-line object-cover" />
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {(isDraft || listing.status === "active") && (
          <Panel title={isDraft ? "Publish" : "End listing"}>
            {isDraft ? (
              <div className="grid gap-3">
                <p className="text-sm text-ink-muted">Publishing re-checks the margin at the worst-case ad rate and uses your store&apos;s business policies.</p>
                {vero.risk === "high" && <p className="text-sm font-medium text-danger">Resolve the brand warning above before publishing.</p>}
                <PublishButton id={listing.id} />
              </div>
            ) : (
              <EndButton id={listing.id} />
            )}
          </Panel>
        )}
      </div>
    </>
  );
}
