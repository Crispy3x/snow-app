import { canManage, requireStore } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { adRateForPrice, guardPrice, rulesFromRow } from "@/lib/margin";
import { previewWatcherOffers, type OfferPreviewRow } from "@/lib/automation/promotions-run";
import { bidForListing, CAMPAIGN_NAME, type BidStrategy } from "@/lib/automation/ads";
import { ebayErrorMessage, type StoreRulesRow } from "@/lib/automation/store";
import { Alert, DataTable, EmptyState, PageHeader, Panel, money, pct, td, th } from "@/components/ui/app";
import { Badge } from "@/components/ui/layout";
import { Select, TextArea, TextInput } from "@/components/ui/form";
import { buttonClasses } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";
import { ActionForm } from "@/components/automation/action-form";
import { applyBids, createSale, saveBidStrategy, sendOffers } from "./actions";

export const metadata = { title: "Offers and promotions" };

type ListingRow = {
  id: string;
  title: string;
  sku: string;
  price: string;
  watchers: number;
  ad_rate_pct: string | null;
  sale_promotion_id: string | null;
  supplier_products: { cost: string | null; shipping_cost: string } | null;
};

const ymd = (d: Date) => d.toISOString().slice(0, 10);

export default async function PromotionsPage({ searchParams }: { searchParams: Promise<{ offers?: string; margin?: string }> }) {
  const ctx = await requireStore();
  const sp = await searchParams;
  const supabase = await createClient();

  const [{ data: rulesRow }, { data: state }, { data: listingRows }, { data: sales }] = await Promise.all([
    supabase.from("store_rules").select("*").eq("store_id", ctx.store.id).maybeSingle(),
    supabase.from("store_automation").select("ad_bid_strategy, ad_campaign_id").eq("store_id", ctx.store.id).maybeSingle(),
    supabase
      .from("listings")
      .select("id, title, sku, price, watchers, ad_rate_pct, sale_promotion_id, supplier_products(cost, shipping_cost)")
      .eq("store_id", ctx.store.id)
      .eq("status", "active")
      .not("ebay_listing_id", "is", null)
      .order("price", { ascending: false })
      .limit(300),
    supabase
      .from("promotions")
      .select("id, name, config, starts_at, ends_at, status")
      .eq("store_id", ctx.store.id)
      .eq("kind", "sale_event")
      .order("created_at", { ascending: false })
      .limit(10),
  ]);
  const r = rulesRow as StoreRulesRow | null;
  const rules = r ? rulesFromRow(r) : null;
  const floor = Number(r?.min_net_margin_pct ?? 20);
  const listings = (listingRows ?? []) as unknown as ListingRow[];
  const tiers = r?.ad_rate_tiers ?? [];
  const strategy = ((state?.ad_bid_strategy as BidStrategy | undefined) ?? "mid") as BidStrategy;
  const manage = canManage(ctx.role);

  // Offers to watchers: only call eBay when the seller asks for the preview.
  const defaultOfferMargin = Number(r?.offer_margin_pct ?? floor + 5);
  const offerMargin = Number(sp.margin) > 0 ? Math.min(95, Number(sp.margin)) : defaultOfferMargin;
  let offerRows: OfferPreviewRow[] | null = null;
  let offerError: string | null = null;
  if (sp.offers === "1") {
    try {
      offerRows = await previewWatcherOffers(ctx.store.id, ctx.org.id, offerMargin);
    } catch (e) {
      offerError = ebayErrorMessage(e);
    }
  }

  const saleDefault = Number(r?.sale_discount_pct) > 0 ? Number(r?.sale_discount_pct) : 10;
  const saleable = listings.filter((l) => !l.sale_promotion_id);
  const today = new Date();

  return (
    <>
      <PageHeader
        title="Offers and promotions"
        description="Send offers to watchers, run sale events and set promoted-listing bids. Every price is checked against your margin floor first."
      />

      <div className="space-y-8">
        {/* ---------------- Offers to watchers ---------------- */}
        <Panel title="Offers to watchers" description="eBay lets you send a one-time offer to buyers who are watching a listing.">
          <form method="get" className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <input type="hidden" name="offers" value="1" />
            <TextInput
              id="margin"
              name="margin"
              type="number"
              step="0.5"
              min={floor}
              max={95}
              label="Target net margin (%)"
              defaultValue={offerMargin}
              hint={`Floor is ${floor}%. Offers never go below it.`}
              fieldClassName="sm:w-56"
            />
            <button type="submit" className={buttonClasses("secondary", "md", "sm:mb-6")}>
              Find eligible listings
            </button>
          </form>

          {offerError && (
            <div className="mt-4">
              <Alert tone="danger" title="Couldn't load eligible listings">{offerError}</Alert>
            </div>
          )}
          {offerRows && offerRows.length === 0 && (
            <p className="mt-4 text-sm text-ink-muted">No listings are eligible right now. eBay needs interested buyers (watchers) first.</p>
          )}
          {offerRows && offerRows.length > 0 && (
            <ActionForm action={sendOffers} className="mt-4 space-y-4" aria-label="Send offers">
              <input type="hidden" name="margin" value={offerMargin} />
              <DataTable caption="Offer preview">
                <thead>
                  <tr>
                    <th className={th} scope="col"><span className="sr-only">Select</span></th>
                    <th className={th} scope="col">Listing</th>
                    <th className={th} scope="col">Watchers</th>
                    <th className={th} scope="col">Price</th>
                    <th className={th} scope="col">Offer</th>
                    <th className={th} scope="col">Margin</th>
                  </tr>
                </thead>
                <tbody>
                  {offerRows.map((o) => (
                    <tr key={o.id}>
                      <td className={td}>
                        <input
                          type="checkbox"
                          name="listingIds"
                          value={o.id}
                          defaultChecked={o.quote.ok}
                          disabled={!o.quote.ok}
                          aria-label={`Send offer for ${o.title}`}
                          className="mt-1 h-4 w-4 accent-accent"
                        />
                      </td>
                      <td className={td}>
                        <p className="font-medium">{o.title}</p>
                        <p className="text-xs text-ink-muted">{o.sku}</p>
                      </td>
                      <td className={`${td} tabular-nums`}>{o.watchers}</td>
                      <td className={`${td} tabular-nums`}>{money(o.price)}</td>
                      <td className={`${td} tabular-nums`}>
                        {o.quote.ok ? (
                          <>
                            {money(o.quote.price)} <span className="text-ink-muted">({o.quote.discountPct}% off)</span>
                          </>
                        ) : (
                          <span className="text-ink-muted">{o.quote.reason}</span>
                        )}
                      </td>
                      <td className={`${td} tabular-nums`}>{o.quote.ok ? pct(o.quote.marginPct) : "–"}</td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
              <TextArea
                id="offer-message"
                name="message"
                label="Message to buyers (optional)"
                rows={3}
                maxLength={2000}
                hint="Shown with the offer. Offers last 2 days and can't be cancelled once sent."
              />
              <SubmitButton pendingText="Sending…">Send selected offers</SubmitButton>
            </ActionForm>
          )}
        </Panel>

        {/* ---------------- Sale events ---------------- */}
        <Panel title="Sale event" description="A markdown sale with a percentage off. Each listing can be in one sale at a time.">
          {saleable.length === 0 ? (
            <EmptyState title="No listings available">All active listings are already in a sale, or none are live yet.</EmptyState>
          ) : (
            <ActionForm action={createSale} className="space-y-4" aria-label="Create sale event">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <TextInput id="sale-name" name="name" label="Sale name" required maxLength={90} defaultValue={`Sale ${ymd(today)}`} />
                <TextInput id="sale-discount" name="discount" type="number" min={5} max={80} step={1} label="Discount (%)" required defaultValue={saleDefault} />
                <TextInput id="sale-start" name="start" type="date" label="Starts" required defaultValue={ymd(today)} min={ymd(today)} />
                <TextInput id="sale-end" name="end" type="date" label="Ends" required defaultValue={ymd(new Date(today.getTime() + 7 * 86_400_000))} min={ymd(today)} />
              </div>
              <DataTable caption="Listings for the sale">
                <thead>
                  <tr>
                    <th className={th} scope="col"><span className="sr-only">Select</span></th>
                    <th className={th} scope="col">Listing</th>
                    <th className={th} scope="col">Price</th>
                    <th className={th} scope="col">Margin at {saleDefault}% off</th>
                  </tr>
                </thead>
                <tbody>
                  {saleable.map((l) => {
                    const cost = l.supplier_products?.cost;
                    const g =
                      rules && cost !== null && cost !== undefined
                        ? guardPrice(Number(l.price), { supplierCost: Number(cost), supplierShipping: Number(l.supplier_products?.shipping_cost) || 0 }, { ...rules, saleDiscountPct: saleDefault })
                        : null;
                    return (
                      <tr key={l.id}>
                        <td className={td}>
                          <input type="checkbox" name="listingIds" value={l.id} aria-label={`Include ${l.title}`} className="mt-1 h-4 w-4 accent-accent" />
                        </td>
                        <td className={td}>
                          <p className="font-medium">{l.title}</p>
                          <p className="text-xs text-ink-muted">{l.sku}</p>
                        </td>
                        <td className={`${td} tabular-nums`}>{money(l.price)}</td>
                        <td className={`${td} tabular-nums`}>
                          {g ? (
                            <span className={g.ok ? "" : "font-semibold text-danger"}>
                              {pct(g.breakdown.marginPct)}
                              {!g.ok && " (below floor)"}
                            </span>
                          ) : (
                            <span className="text-ink-muted">No supplier cost</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </DataTable>
              <p className="text-sm text-ink-muted">Listings that would drop below the {floor}% floor at the chosen discount are left out automatically.</p>
              <SubmitButton pendingText="Creating…">Create sale</SubmitButton>
            </ActionForm>
          )}
          {sales && sales.length > 0 && (
            <div className="mt-6">
              <h3 className="mb-2 text-sm font-semibold">Recent sales</h3>
              <ul className="space-y-1 text-sm">
                {sales.map((s) => (
                  <li key={s.id as string}>
                    <span className="font-medium">{s.name as string}</span>{" "}
                    <span className="text-ink-muted">
                      {(s.config as { percentOff?: number })?.percentOff}% off ·{" "}
                      {s.starts_at ? new Date(s.starts_at as string).toLocaleDateString("en-US") : ""} to{" "}
                      {s.ends_at ? new Date(s.ends_at as string).toLocaleDateString("en-US") : ""}
                    </span>{" "}
                    <Badge>{s.status as string}</Badge>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Panel>

        {/* ---------------- Promoted listings ---------------- */}
        <Panel
          title="Promoted listings"
          description={`One cost-per-sale campaign ("${CAMPAIGN_NAME}"). Each listing bids from its price tier, never above the rate your margin guard assumes.`}
        >
          {tiers.length === 0 ? (
            <Alert tone="info" title="No ad-rate tiers yet">Add ad-rate tiers to your store rules to promote listings.</Alert>
          ) : (
            <>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
                <ActionForm action={saveBidStrategy} className="flex flex-col gap-3 sm:flex-row sm:items-end">
                  <Select
                    id="strategy"
                    name="strategy"
                    label="Bid within each tier"
                    defaultValue={strategy}
                    disabled={!manage}
                    options={[
                      { value: "min", label: "Lowest rate" },
                      { value: "mid", label: "Middle of the range" },
                      { value: "max", label: "Highest rate" },
                    ]}
                  />
                  <SubmitButton variant="secondary" disabled={!manage} pendingText="Saving…">
                    Save
                  </SubmitButton>
                </ActionForm>
                <ActionForm action={applyBids}>
                  <SubmitButton disabled={!manage} pendingText="Updating eBay…">
                    Apply bids on eBay
                  </SubmitButton>
                </ActionForm>
              </div>
              {!manage && <p className="mt-2 text-sm text-ink-muted">Only owners and admins can change bids.</p>}
              <div className="mt-4">
                <DataTable caption="Ad rates per listing">
                  <thead>
                    <tr>
                      <th className={th} scope="col">Listing</th>
                      <th className={th} scope="col">Price</th>
                      <th className={th} scope="col">Tier range</th>
                      <th className={th} scope="col">Planned bid</th>
                      <th className={th} scope="col">Current bid</th>
                    </tr>
                  </thead>
                  <tbody>
                    {listings.map((l) => {
                      const range = adRateForPrice(tiers, Number(l.price));
                      const bid = bidForListing(tiers, Number(l.price), strategy);
                      const current = l.ad_rate_pct === null ? null : Number(l.ad_rate_pct);
                      return (
                        <tr key={l.id}>
                          <td className={td}>
                            <p className="font-medium">{l.title}</p>
                            <p className="text-xs text-ink-muted">{l.sku}</p>
                          </td>
                          <td className={`${td} tabular-nums`}>{money(l.price)}</td>
                          <td className={`${td} tabular-nums`}>{range.max > 0 ? `${pct(range.min)} to ${pct(range.max)}` : "No tier"}</td>
                          <td className={`${td} tabular-nums`}>{bid === null ? "Not promoted" : pct(bid)}</td>
                          <td className={`${td} tabular-nums`}>
                            {current === null ? "–" : pct(current)}
                            {bid !== null && current !== null && Math.abs(current - bid) >= 0.05 && (
                              <span className="ml-2">
                                <Badge tone="amber">changes</Badge>
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </DataTable>
              </div>
            </>
          )}
        </Panel>
      </div>
    </>
  );
}
