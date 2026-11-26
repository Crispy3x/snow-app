import { requireStore } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadStoreRules } from "@/lib/ai-tools/audit-run";
import { worstCaseAdRate } from "@/lib/ai-tools/pricing";
import { PageHeader, Panel, TextLink, money } from "@/components/ui/app";
import { AiCredits } from "@/components/ai-tools/credits";
import { PricingForm, type ListingOption } from "./pricing-form";

export const metadata = { title: "Pricing advisor" };

export default async function PricingPage({ searchParams }: { searchParams: Promise<{ listing?: string }> }) {
  const ctx = await requireStore();
  const { listing } = await searchParams;
  const db = createAdminClient();
  const [{ data }, rules] = await Promise.all([
    db
      .from("listings")
      .select("id, title, sku, price, status, supplier_products(cost, shipping_cost)")
      .eq("org_id", ctx.org.id)
      .eq("store_id", ctx.store.id)
      .in("status", ["draft", "active", "out_of_stock", "blocked_margin"])
      .order("title")
      .limit(1000),
    loadStoreRules(ctx.store.id),
  ]);
  const options: ListingOption[] = (data ?? []).map((l) => {
    const sp = l.supplier_products as unknown as { cost: number | null; shipping_cost: number | null } | null;
    return {
      id: l.id,
      label: `${l.title.slice(0, 70)} (${l.sku}) · ${money(l.price)}${l.status === "draft" ? " · draft" : ""}`,
      cost: sp?.cost != null ? Number(sp.cost) : null,
      shipping: sp?.shipping_cost != null ? Number(sp.shipping_cost) : null,
    };
  });

  return (
    <>
      <PageHeader
        title="Pricing advisor"
        description="Get a price recommendation from your costs, fees and margin rules, plus competitor prices you enter yourself."
        actions={<AiCredits orgId={ctx.org.id} tool="pricing_advisor" />}
      />
      <div className="grid gap-6">
        <Panel>
          <p className="text-sm text-ink-muted">
            Using your store rules: {rules.minNetMarginPct}% margin floor, {rules.finalValueFeePct}% final value fee, {money(rules.perOrderFee)} per order,
            worst-case ad rate {worstCaseAdRate(rules)}%{rules.saleDiscountPct ? `, ${rules.saleDiscountPct}% sale discount` : ""}.{" "}
            <TextLink href="/app/settings">Edit rules</TextLink>
          </p>
          <p className="mt-2 text-sm text-ink-muted">
            The advisor never looks up eBay prices. Only the competitor prices you type in are used, and the recommendation is never below your floor price.
          </p>
        </Panel>
        <PricingForm listings={options} initialListingId={options.some((o) => o.id === listing) ? listing! : ""} />
      </div>
    </>
  );
}
