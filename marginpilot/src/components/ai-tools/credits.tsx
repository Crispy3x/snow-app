import { aiCreditBalance } from "@/lib/limits";
import { AI_TOOLS, type AiToolKey } from "@/config/ai";
import { TextLink } from "@/components/ui/app";

/** Remaining monthly AI credits, shown on every AI tool page. */
export async function AiCredits({ orgId, tool, perRunNote }: { orgId: string; tool: AiToolKey; perRunNote?: string }) {
  const b = await aiCreditBalance(orgId);
  const cost = AI_TOOLS[tool].credits;
  const low = b.remaining < cost;
  return (
    <div className={`rounded-md border px-3 py-2 text-sm ${low ? "border-danger/30 bg-red-50 text-danger" : "border-line bg-card"}`} role="status">
      <span className="font-semibold tabular-nums">{Math.max(0, b.remaining).toLocaleString()}</span> of {b.allowance.toLocaleString()} AI credits left this month.{" "}
      <span className={low ? "" : "text-ink-muted"}>{perRunNote ?? `Each run uses ${cost}.`}</span>
      {low && (
        <>
          {" "}
          <TextLink href="/app/billing">Get more credits</TextLink>
        </>
      )}
    </div>
  );
}

export function DraftBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    draft: "bg-amber-soft text-ink border-amber/60",
    approved: "bg-accent-soft text-accent-strong border-accent/20",
    applied: "bg-accent-soft text-accent-strong border-accent/20",
    rejected: "bg-paper text-ink-muted border-line",
  };
  const label: Record<string, string> = { draft: "Draft", approved: "Approved", applied: "Applied", rejected: "Discarded" };
  return <span className={`inline-flex items-center rounded border px-2 py-0.5 text-xs font-semibold ${map[status] ?? map.draft}`}>{label[status] ?? status}</span>;
}
