import { notFound } from "next/navigation";
import { PageHeader, Panel, TextLink } from "@/components/ui/app";
import { Badge } from "@/components/ui/layout";
import { AI_TOOLS, type AiToolKey } from "@/config/ai";
import { isUuid } from "@/lib/admin/flag-rules";
import { aiStatusTone } from "@/lib/admin/labels";
import { adminContext, formatDateTime, userEmails } from "@/lib/admin/server";
import { formatTokens, usd } from "@/lib/admin/usage";

export const metadata = { title: "AI request" };

function Json({ value, label }: { value: unknown; label: string }) {
  const text = value === null || value === undefined ? "(none)" : typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return (
    <pre
      tabIndex={0}
      aria-label={label}
      className="max-h-[32rem] overflow-auto whitespace-pre-wrap break-words rounded-md border border-line bg-paper p-3 font-mono text-xs leading-relaxed"
    >
      {text}
    </pre>
  );
}

export default async function AiRequestPage({ params }: { params: Promise<{ requestId: string }> }) {
  const { db } = await adminContext();
  const { requestId } = await params;
  if (!isUuid(requestId)) notFound();

  const { data } = await db.from("ai_requests").select("*").eq("id", requestId).maybeSingle();
  if (!data) notFound();
  const r = data as {
    id: string; org_id: string; user_id: string | null; store_id: string | null; tool: string; model: string;
    prompt: unknown; output: unknown; draft_status: string; input_tokens: number | null; output_tokens: number | null;
    cache_read_tokens: number | null; cost_usd: string | null; credits: number; status: string; error: string | null; created_at: string;
  };

  const [{ data: org }, emails] = await Promise.all([
    db.from("organizations").select("name").eq("id", r.org_id).maybeSingle(),
    userEmails(db, [r.user_id]),
  ]);

  const meta: [string, React.ReactNode][] = [
    ["When", formatDateTime(r.created_at)],
    ["Workspace", <TextLink key="org" href={`/admin/users/${r.org_id}`}>{(org?.name as string) ?? r.org_id}</TextLink>],
    ["User", r.user_id ? (emails.get(r.user_id) ?? r.user_id) : "Background job"],
    ["Tool", AI_TOOLS[r.tool as AiToolKey]?.label ?? r.tool],
    ["Model", r.model],
    ["Status", <Badge key="s" tone={aiStatusTone(r.status)}>{r.status.replace("_", " ")}</Badge>],
    ["Draft status", r.draft_status],
    ["Tokens", `${formatTokens(r.input_tokens ?? 0)} in, ${formatTokens(r.output_tokens ?? 0)} out, ${formatTokens(r.cache_read_tokens ?? 0)} cache read`],
    ["Cost", usd(Number(r.cost_usd ?? 0))],
    ["Credits", r.credits.toLocaleString()],
  ];

  return (
    <>
      <p className="mb-2 text-sm">
        <TextLink href={`/admin/ai-usage?month=${r.created_at.slice(0, 7)}`}>Back to AI usage</TextLink>
      </p>
      <PageHeader title="AI request" description={`Request ${r.id}. The prompt is stored as sent, with buyer details already removed.`} />

      <Panel>
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          {meta.map(([k, v]) => (
            <div key={k}>
              <dt className="text-ink-muted">{k}</dt>
              <dd className="font-medium break-all">{v}</dd>
            </div>
          ))}
        </dl>
        {r.error && (
          <p role="note" className="mt-4 rounded-md border border-danger/30 bg-red-50 px-3 py-2 text-sm text-danger">
            Error: {r.error}
          </p>
        )}
      </Panel>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Panel title="Prompt">
          <Json value={r.prompt} label="Logged prompt" />
        </Panel>
        <Panel title="Output">
          <Json value={r.output} label="Logged output" />
        </Panel>
      </div>
    </>
  );
}
