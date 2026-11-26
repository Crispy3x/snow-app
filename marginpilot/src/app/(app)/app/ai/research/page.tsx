import Link from "next/link";
import { requireStore } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { priceForMargin } from "@/lib/margin";
import { loadStoreRules } from "@/lib/ai-tools/audit-run";
import { worstCaseAdRate } from "@/lib/ai-tools/pricing";
import { isUuid } from "@/lib/ai-tools/drafts";
import type { OwnSalesContext, ResearchStructure } from "@/lib/ai-tools/research";
import { Alert, PageHeader, Panel, money } from "@/components/ui/app";
import { Badge } from "@/components/ui/layout";
import { SubmitButton } from "@/components/ui/submit-button";
import { AiCredits, DraftBadge } from "@/components/ai-tools/credits";
import { ResearchForm } from "./research-form";
import { setResearchStatus } from "./actions";

export const metadata = { title: "Product research" };
export const maxDuration = 300;

type RunRow = {
  id: string;
  query: string;
  price_min: number | null;
  price_max: number | null;
  target_margin_pct: number | null;
  report: string;
  structured: ResearchStructure | null;
  sources: { url: string; title: string }[];
  own_data: OwnSalesContext;
  draft_status: string;
  created_at: string;
};

export default async function ResearchPage({ searchParams }: { searchParams: Promise<{ run?: string }> }) {
  const ctx = await requireStore();
  const { run: runId } = await searchParams;
  const db = createAdminClient();
  const { data: runs } = await db
    .from("research_runs")
    .select("id, query, draft_status, created_at")
    .eq("org_id", ctx.org.id)
    .eq("store_id", ctx.store.id)
    .neq("draft_status", "rejected")
    .order("created_at", { ascending: false })
    .limit(20);

  let run: RunRow | null = null;
  if (isUuid(runId)) {
    const { data } = await db.from("research_runs").select("*").eq("id", runId).eq("org_id", ctx.org.id).maybeSingle();
    run = data as RunRow | null;
  }
  const rules = await loadStoreRules(ctx.store.id);

  return (
    <>
      <PageHeader
        title="Product research"
        description="Find product ideas from current web sources and your own sales history. Wholesale sourcing only."
        actions={<AiCredits orgId={ctx.org.id} tool="research" />}
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
        <div className="grid min-w-0 gap-6">
          <Panel title="New research" description="Uses web search with sources listed, plus your store's own best sellers. It does not use eBay sold-listing or market data.">
            <ResearchForm />
          </Panel>

          {runId && !run && <Alert tone="warning">That research run wasn&apos;t found.</Alert>}
          {run && <RunView run={run} rules={rules} />}
        </div>

        <Panel title="Past research">
          {runs?.length ? (
            <ul className="grid gap-1">
              {runs.map((r) => (
                <li key={r.id}>
                  <Link
                    href={`/app/ai/research?run=${r.id}`}
                    aria-current={r.id === run?.id ? "page" : undefined}
                    className={`block rounded-md px-2 py-2 text-sm hover:bg-ink/5 ${r.id === run?.id ? "bg-accent-soft font-semibold" : ""}`}
                  >
                    <span className="block truncate">{r.query}</span>
                    <span className="mt-0.5 flex items-center gap-2 text-xs text-ink-muted">
                      {new Date(r.created_at).toLocaleDateString("en-US")} <DraftBadge status={r.draft_status} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-muted">No research yet.</p>
          )}
        </Panel>
      </div>
    </>
  );
}

function RunView({ run, rules }: { run: RunRow; rules: Awaited<ReturnType<typeof loadStoreRules>> }) {
  const s = run.structured;
  const sources = (run.sources ?? []).filter((x) => /^https?:\/\//i.test(x.url));
  const target = run.target_margin_pct ? Number(run.target_margin_pct) : rules.minNetMarginPct;
  const worst = { ...rules, adRatePct: worstCaseAdRate(rules) };
  const priceAt = (cost: number | null) => (cost == null ? null : priceForMargin(target, { supplierCost: cost }, worst, { charm: true }));

  return (
    <Panel
      title={`Research: ${run.query}`}
      description={`Run ${new Date(run.created_at).toLocaleString("en-US")}. AI draft: check sources before acting on it.`}
      actions={<DraftBadge status={run.draft_status} />}
    >
      <div className="grid gap-6">
        {s && (
          <>
            <section>
              <h3 className="font-semibold">Demand signals</h3>
              <p className="mt-1">{s.demandSummary}</p>
            </section>
            <section>
              <h3 className="font-semibold">Product ideas</h3>
              <ul className="mt-2 grid gap-3">
                {s.ideas.map((idea, i) => {
                  const lo = priceAt(idea.wholesaleCostLow);
                  const hi = priceAt(idea.wholesaleCostHigh ?? idea.wholesaleCostLow);
                  return (
                    <li key={i} className="rounded-md border border-line p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold">{idea.name}</p>
                        {idea.veroOrBrandRisk && <Badge tone="danger">Brand / VeRO risk</Badge>}
                        {idea.restrictedCategoryRisk && <Badge tone="amber">Restricted category risk</Badge>}
                      </div>
                      <p className="mt-1 text-sm">{idea.why}</p>
                      <p className="mt-2 text-sm">
                        <span className="font-medium">Wholesale cost: </span>
                        {idea.wholesaleCostLow != null ? `${money(idea.wholesaleCostLow)}${idea.wholesaleCostHigh != null ? ` to ${money(idea.wholesaleCostHigh)}` : ""} per unit` : "not found"}
                        {lo != null && (
                          <span className="text-ink-muted">
                            {" "}· price for {target}% margin with your fees: {money(lo)}
                            {hi != null && hi !== lo ? ` to ${money(hi)}` : ""} (before supplier shipping)
                          </span>
                        )}
                      </p>
                      {idea.risks.length > 0 && (
                        <ul className="mt-2 list-disc pl-5 text-sm">
                          {idea.risks.map((r, j) => (
                            <li key={j}>{r}</li>
                          ))}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
            {s.cautions.length > 0 && (
              <Alert tone="warning" title="Cautions">
                <ul className="list-disc pl-5">
                  {s.cautions.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              </Alert>
            )}
          </>
        )}

        <details open={!s} className="rounded-md border border-line">
          <summary className="cursor-pointer px-4 py-3 font-semibold">Full report</summary>
          <div className="whitespace-pre-wrap break-words border-t border-line px-4 py-3 text-sm">{run.report}</div>
        </details>

        <section>
          <h3 className="font-semibold">Sources</h3>
          {sources.length ? (
            <ol className="mt-2 grid list-decimal gap-1 pl-5 text-sm">
              {sources.map((src) => (
                <li key={src.url} className="break-words">
                  <a href={src.url} target="_blank" rel="noopener noreferrer nofollow" className="font-medium text-accent underline underline-offset-2 hover:text-accent-strong">
                    {src.title || src.url}
                  </a>{" "}
                  <span className="text-ink-muted">{safeHost(src.url)}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-1 text-sm text-ink-muted">No web sources were returned for this run, so treat the ideas as unverified.</p>
          )}
        </section>

        <section className="text-sm text-ink-muted">
          <h3 className="font-semibold text-ink">Your store data used</h3>
          {run.own_data.orders ? (
            <p className="mt-1">
              {run.own_data.orders} order lines from the last {run.own_data.windowDays} days. Best sellers:{" "}
              {run.own_data.topListings.slice(0, 5).map((l) => l.title).join("; ")}.
            </p>
          ) : (
            <p className="mt-1">No sales history in this store yet.</p>
          )}
          <p className="mt-2">
            This research does not use eBay sold-listing or Marketplace Insights data. Before listing, check eBay&apos;s{" "}
            <a className="font-medium text-accent underline" href="https://www.ebay.com/help/policies/prohibited-restricted-items/prohibited-restricted-items?id=4207" target="_blank" rel="noopener noreferrer">
              prohibited and restricted items policy
            </a>{" "}
            and the{" "}
            <a className="font-medium text-accent underline" href="https://www.ebay.com/sellercenter/ebay-for-business/verified-rights-owner-program" target="_blank" rel="noopener noreferrer">
              VeRO program
            </a>
            .
          </p>
        </section>

        {run.draft_status === "draft" && (
          <div className="flex flex-wrap gap-2 border-t border-line pt-4">
            <form action={setResearchStatus}>
              <input type="hidden" name="runId" value={run.id} />
              <input type="hidden" name="status" value="approved" />
              <SubmitButton pendingText="Saving…">Save to my research</SubmitButton>
            </form>
            <form action={setResearchStatus}>
              <input type="hidden" name="runId" value={run.id} />
              <input type="hidden" name="status" value="rejected" />
              <SubmitButton variant="secondary" pendingText="Discarding…">Discard</SubmitButton>
            </form>
          </div>
        )}
      </div>
    </Panel>
  );
}

function safeHost(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
