import { notFound } from "next/navigation";
import { canManage, getAppContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getEbayClient } from "@/lib/ebay/client";
import { getLocations, getPolicies } from "@/lib/ebay/api";
import { Alert, PageHeader, Panel, TextLink } from "@/components/ui/app";
import { LinkButton } from "@/components/ui/button";
import { RulesForm, type RulesValues } from "./rules-form";
import { CreateLocationForm, ListingDefaultsForm } from "./defaults-forms";

export const metadata = { title: "Store rules" };

const DEFAULTS: RulesValues = {
  min_net_margin_pct: 20,
  final_value_fee_pct: 13.6,
  per_order_fee: 0.4,
  tax_on_cost_pct: 0,
  sale_discount_pct: 0,
  min_price: 0,
  handling_days: 2,
  shipping_regions: ["US"],
  ad_rate_tiers: [],
  monitor_action: "flag",
  monitor_interval_hours: 12,
  reprice_requires_approval: true,
  offer_margin_pct: null,
  cleanup_after_days: null,
  cleanup_queue_replacements: false,
};

const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));

async function loadEbayChoices(storeId: string) {
  try {
    const c = await getEbayClient(storeId);
    const [policies, locations] = await Promise.all([getPolicies(c), getLocations(c)]);
    return {
      ok: true as const,
      fulfillment: policies.fulfillment.map((p) => ({ value: p.fulfillmentPolicyId, label: p.name })),
      payment: policies.payment.map((p) => ({ value: p.paymentPolicyId, label: p.name })),
      returns: policies.return.map((p) => ({ value: p.returnPolicyId, label: p.name })),
      locations: (locations.locations ?? []).map((l) => ({ value: l.merchantLocationKey, label: l.merchantLocationKey })),
    };
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : "eBay didn't respond." };
  }
}

export default async function StoreRulesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ welcome?: string }>;
}) {
  const [{ id }, sp, ctx] = await Promise.all([params, searchParams, getAppContext()]);
  const store = ctx.stores.find((s) => s.id === id);
  if (!store) notFound();
  const canEdit = canManage(ctx.role);

  const supabase = await createClient();
  const [{ data: row }, { data: settings }] = await Promise.all([
    supabase.from("store_rules").select("*").eq("store_id", id).maybeSingle(),
    supabase.from("store_settings").select("*").eq("store_id", id).maybeSingle(),
  ]);

  const values: RulesValues = row
    ? {
        min_net_margin_pct: Number(row.min_net_margin_pct),
        final_value_fee_pct: Number(row.final_value_fee_pct),
        per_order_fee: Number(row.per_order_fee),
        tax_on_cost_pct: Number(row.tax_on_cost_pct),
        sale_discount_pct: Number(row.sale_discount_pct),
        min_price: Number(row.min_price),
        handling_days: row.handling_days,
        shipping_regions: row.shipping_regions ?? ["US"],
        ad_rate_tiers: row.ad_rate_tiers ?? [],
        monitor_action: row.monitor_action,
        monitor_interval_hours: row.monitor_interval_hours,
        reprice_requires_approval: row.reprice_requires_approval,
        offer_margin_pct: n(row.offer_margin_pct),
        cleanup_after_days: n(row.cleanup_after_days),
        cleanup_queue_replacements: row.cleanup_queue_replacements,
      }
    : DEFAULTS;

  const choices = store.status === "active" ? await loadEbayChoices(id) : null;
  const current = {
    fulfillment_policy_id: settings?.fulfillment_policy_id ?? null,
    payment_policy_id: settings?.payment_policy_id ?? null,
    return_policy_id: settings?.return_policy_id ?? null,
    merchant_location_key: settings?.merchant_location_key ?? null,
  };
  const name = store.label || store.ebay_username || "eBay store";

  return (
    <>
      <PageHeader
        title="Store rules"
        description={`${name}: the guardrails every listing, price change and offer follows.`}
        actions={
          <LinkButton href="/app/stores" variant="secondary">
            All stores
          </LinkButton>
        }
      />
      <div className="space-y-6">
        {sp.welcome && (
          <Alert tone="success" title={`${name} is connected`}>
            Next, check these rules. The defaults are safe starting points; adjust the fees to match your eBay account, then save.
          </Alert>
        )}
        {store.status !== "active" && (
          <Alert tone="warning" title="This store needs to be reconnected">
            You can edit rules, but business policies and locations load from eBay once the store is reconnected.{" "}
            <TextLink href="/app/stores">Go to stores</TextLink>
          </Alert>
        )}
        {!canEdit && <Alert tone="info">You can view these rules. Only workspace owners and admins can change them.</Alert>}

        <Panel title="Pricing, ads and automation" description="Saved per store.">
          <RulesForm storeId={id} values={values} canEdit={canEdit} />
        </Panel>

        <Panel
          title="Listing defaults"
          description="Business policies and the ship-from location used for every new listing from this store."
        >
          {!choices ? (
            <p className="text-sm text-ink-muted">Reconnect the store to load its business policies.</p>
          ) : !choices.ok ? (
            <Alert tone="danger" title="Couldn't load policies from eBay">
              {choices.error} Reload the page to try again.
            </Alert>
          ) : (
            <div className="space-y-6">
              {(choices.fulfillment.length === 0 || choices.payment.length === 0 || choices.returns.length === 0) && (
                <Alert tone="warning" title="Some business policies are missing">
                  Create shipping, payment and return policies in eBay Seller Hub (Account, Business policies), then reload this page. eBay
                  needs one of each to publish a listing.
                </Alert>
              )}
              <ListingDefaultsForm
                storeId={id}
                canEdit={canEdit}
                fulfillment={choices.fulfillment}
                payment={choices.payment}
                returns={choices.returns}
                locations={
                  current.merchant_location_key && !choices.locations.some((l) => l.value === current.merchant_location_key)
                    ? [...choices.locations, { value: current.merchant_location_key, label: current.merchant_location_key }]
                    : choices.locations
                }
                current={current}
              />
              {canEdit && (
                <div className="border-t border-line pt-5">
                  <h3 className="text-base font-semibold">Create a ship-from location</h3>
                  <p className="mb-3 text-sm text-ink-muted">
                    {choices.locations.length === 0
                      ? "This store has no inventory location yet. Create one to start listing."
                      : "Add another location and make it the default."}
                  </p>
                  <CreateLocationForm storeId={id} />
                </div>
              )}
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}
