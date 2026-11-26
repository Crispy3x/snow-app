/**
 * Pure helpers for the admin AI usage report: month ranges and aggregation of
 * the grouped rows returned by the admin_ai_usage() database function.
 */

export type UsageRow = {
  org_id: string;
  user_id: string | null;
  tool: string;
  model: string;
  status: string; // ok | error | rate_limited | refused
  requests: number | string;
  input_tokens: number | string;
  output_tokens: number | string;
  cache_read_tokens: number | string;
  cost_usd: number | string;
  credits: number | string;
};

export type UsageTotals = {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  costUsd: number;
  credits: number;
  errors: number; // error + rate_limited
  refusals: number;
};

export const emptyTotals = (): UsageTotals => ({
  requests: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  costUsd: 0,
  credits: 0,
  errors: 0,
  refusals: 0,
});

function add(t: UsageTotals, r: UsageRow) {
  const n = Number(r.requests) || 0;
  t.requests += n;
  t.inputTokens += Number(r.input_tokens) || 0;
  t.outputTokens += Number(r.output_tokens) || 0;
  t.cacheReadTokens += Number(r.cache_read_tokens) || 0;
  t.costUsd += Number(r.cost_usd) || 0;
  t.credits += Number(r.credits) || 0;
  if (r.status === "error" || r.status === "rate_limited") t.errors += n;
  if (r.status === "refused") t.refusals += n;
}

/** Group rows by a key and sum, sorted by cost (highest first), then requests. */
export function groupUsage(rows: UsageRow[], keyOf: (r: UsageRow) => string): { key: string; totals: UsageTotals }[] {
  const map = new Map<string, UsageTotals>();
  for (const r of rows) {
    const k = keyOf(r);
    let t = map.get(k);
    if (!t) map.set(k, (t = emptyTotals()));
    add(t, r);
  }
  return [...map.entries()]
    .map(([key, totals]) => ({ key, totals }))
    .sort((a, b) => b.totals.costUsd - a.totals.costUsd || b.totals.requests - a.totals.requests);
}

export function totalUsage(rows: UsageRow[]): UsageTotals {
  const t = emptyTotals();
  rows.forEach((r) => add(t, r));
  return t;
}

/** "2026-11" -> UTC range [from, to) plus the credit period start. Bad input falls back to `now`'s month. */
export function monthRange(month: string | undefined | null, now = new Date()): {
  month: string;
  from: string;
  to: string;
  periodStart: string;
} {
  let y = now.getUTCFullYear();
  let m = now.getUTCMonth() + 1;
  const match = /^(\d{4})-(\d{2})$/.exec(month ?? "");
  if (match) {
    const yy = Number(match[1]);
    const mm = Number(match[2]);
    if (yy >= 2000 && yy <= 2100 && mm >= 1 && mm <= 12) {
      y = yy;
      m = mm;
    }
  }
  const from = new Date(Date.UTC(y, m - 1, 1));
  const to = new Date(Date.UTC(y, m, 1));
  return {
    month: `${y}-${String(m).padStart(2, "0")}`,
    from: from.toISOString(),
    to: to.toISOString(),
    periodStart: from.toISOString().slice(0, 10),
  };
}

/** Escape LIKE/ILIKE wildcards in a user search string. */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 10_000) return `${(n / 1000).toFixed(1)}k`;
  return n.toLocaleString("en-US");
}

export function usd(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: n < 1 && n > 0 ? 4 : 2 });
}
