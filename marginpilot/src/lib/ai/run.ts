import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { AI_TOOLS, FALLBACK_MODELS, MODELS, estimateCostUsd, type AiToolKey, type ModelTier } from "@/config/ai";
import { createAdminClient } from "@/lib/supabase/admin";
import { aiCreditBalance, creditPeriodStart } from "@/lib/limits";

/**
 * The one place the app calls Claude. Every AI tool goes through runAi(), which:
 * - checks the org has enough monthly AI credits,
 * - picks the model for the tool (cheap model for bulk, stronger for research/chat),
 * - turns on the server-side refusal fallback where the model supports it,
 * - logs the (PII-minimised) prompt and output to ai_requests,
 * - charges credits only on success, and
 * - maps API errors (429, overload, refusal) to a clear, typed result.
 * Output is always a draft: callers store it with draft_status 'draft' for the user to approve.
 */

let client: Anthropic | null = null;
function anthropic() {
  if (!client) client = new Anthropic({ maxRetries: 2 });
  return client;
}

export type AiErrorCode = "no_credits" | "rate_limited" | "unavailable" | "refused" | "bad_request" | "not_configured" | "failed";

export type AiResult<T> =
  | {
      ok: true;
      requestId: string;
      output: T;
      text: string;
      content: Anthropic.Beta.BetaContentBlock[];
      model: string;
    }
  | { ok: false; error: AiErrorCode; message: string; requestId?: string };

export type RunAiOptions<T> = {
  orgId: string;
  userId: string | null;
  storeId?: string | null;
  tool: AiToolKey;
  /** Use the tool's bulk tier (cheaper model) for batch jobs. */
  bulk?: boolean;
  tier?: ModelTier;
  system: string;
  messages: Anthropic.Beta.BetaMessageParam[];
  /** Zod schema for structured output. Omit for free text (e.g. chat, research with sources). */
  schema?: z.ZodType<T>;
  tools?: Anthropic.Beta.BetaToolUnion[];
  maxTokens?: number;
  effort?: "low" | "medium" | "high";
  /** What to store as the prompt in the log. Defaults to messages with images removed. */
  logPrompt?: unknown;
  /** Override credit cost (e.g. per item in a batch). */
  credits?: number;
};

const MESSAGES: Record<AiErrorCode, string> = {
  no_credits: "You've used this month's AI credits. They reset on the 1st, or upgrade your plan for more.",
  rate_limited: "The AI service is busy right now. Please try again in a minute.",
  unavailable: "The AI service is temporarily unavailable. Please try again shortly.",
  refused: "The AI declined this request. Try rewording it or removing unusual content.",
  bad_request: "That request couldn't be processed. Check the input and try again.",
  not_configured: "AI isn't configured yet. Add ANTHROPIC_API_KEY.",
  failed: "Something went wrong generating this draft. Please try again.",
};

function stripImages(messages: Anthropic.Beta.BetaMessageParam[]) {
  return messages.map((m) => ({
    role: m.role,
    content:
      typeof m.content === "string"
        ? m.content
        : (m.content ?? []).map((b) => (b.type === "image" ? { type: "image", note: "[image omitted from log]" } : b)),
  }));
}

export async function runAi<T = string>(opts: RunAiOptions<T>): Promise<AiResult<T>> {
  const toolCfg = AI_TOOLS[opts.tool];
  const tier = opts.tier ?? (opts.bulk && toolCfg.bulkTier ? toolCfg.bulkTier : toolCfg.tier);
  const model = MODELS[tier];
  const credits = opts.credits ?? toolCfg.credits;
  const db = createAdminClient();
  const prompt = opts.logPrompt ?? { system: opts.system, messages: stripImages(opts.messages) };

  async function log(row: Record<string, unknown>) {
    const { data } = await db
      .from("ai_requests")
      .insert({
        org_id: opts.orgId,
        user_id: opts.userId,
        store_id: opts.storeId ?? null,
        tool: opts.tool,
        model,
        prompt,
        ...row,
      })
      .select("id")
      .single();
    return data?.id as string | undefined;
  }

  if (!process.env.ANTHROPIC_API_KEY) return { ok: false, error: "not_configured", message: MESSAGES.not_configured };

  const balance = await aiCreditBalance(opts.orgId);
  if (balance.remaining < credits) return { ok: false, error: "no_credits", message: MESSAGES.no_credits };

  const useFallback = FALLBACK_MODELS.has(model);
  const base = {
    model,
    max_tokens: opts.maxTokens ?? 8000,
    system: [{ type: "text" as const, text: opts.system, cache_control: { type: "ephemeral" as const } }],
    output_config: {
      effort: opts.effort ?? "medium",
      ...(opts.schema ? { format: betaZodOutputFormat(opts.schema) } : {}),
    },
    ...(opts.tools ? { tools: opts.tools } : {}),
    ...(useFallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
  };

  try {
    let messages = [...opts.messages];
    let response: Anthropic.Beta.BetaMessage & { parsed_output?: T | null } | null = null;
    const content: Anthropic.Beta.BetaContentBlock[] = [];
    let inputTokens = 0, outputTokens = 0, cacheRead = 0;

    // Server tools (web search) can pause a long turn; resend to let it continue.
    for (let i = 0; i < 4; i++) {
      response = opts.schema
        ? await anthropic().beta.messages.parse({ ...base, messages } as Parameters<Anthropic["beta"]["messages"]["parse"]>[0])
        : await anthropic().beta.messages.create({ ...base, messages } as Anthropic.Beta.MessageCreateParamsNonStreaming);
      inputTokens += response.usage.input_tokens;
      outputTokens += response.usage.output_tokens;
      cacheRead += response.usage.cache_read_input_tokens ?? 0;
      content.push(...response.content);
      if (response.stop_reason !== "pause_turn") break;
      messages = [...messages, { role: "assistant", content: response.content }];
    }
    if (!response) throw new Error("no response");

    const costUsd = estimateCostUsd(model, { input: inputTokens, output: outputTokens, cacheRead });
    const usage = { input_tokens: inputTokens, output_tokens: outputTokens, cache_read_tokens: cacheRead, cost_usd: costUsd };

    if (response.stop_reason === "refusal") {
      const id = await log({ status: "refused", error: response.stop_details?.category ?? "refusal", credits: 0, ...usage });
      return { ok: false, error: "refused", message: MESSAGES.refused, requestId: id };
    }

    const text = content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");

    let output: T;
    if (opts.schema) {
      const parsed = response.parsed_output;
      if (parsed == null) {
        const id = await log({ status: "error", error: `unparseable output (stop: ${response.stop_reason})`, output: { text }, credits: 0, ...usage });
        return { ok: false, error: "failed", message: MESSAGES.failed, requestId: id };
      }
      output = parsed;
    } else {
      output = text as T;
    }

    const id = await log({ status: "ok", output: opts.schema ? output : { text }, credits, ...usage });
    await db.from("ai_credit_ledger").insert({
      org_id: opts.orgId,
      period_start: creditPeriodStart(),
      delta: -credits,
      reason: opts.tool,
      ai_request_id: id ?? null,
    });

    return { ok: true, requestId: id ?? "", output, text, content, model: response.model };
  } catch (err) {
    let code: AiErrorCode = "failed";
    if (err instanceof Anthropic.RateLimitError) code = "rate_limited";
    else if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) code = "not_configured";
    else if (err instanceof Anthropic.BadRequestError) code = "bad_request";
    else if (err instanceof Anthropic.InternalServerError || err instanceof Anthropic.APIConnectionError) code = "unavailable";
    else if (err instanceof Anthropic.APIError && (err.status === 529 || err.status === 503)) code = "unavailable";
    const id = await log({
      status: code === "rate_limited" ? "rate_limited" : "error",
      error: err instanceof Error ? err.message.slice(0, 500) : String(err),
      credits: 0,
    });
    return { ok: false, error: code, message: MESSAGES[code], requestId: id };
  }
}

/** Sources from web search results in a response, for tools that must show where facts came from. */
export function extractSources(content: Anthropic.Beta.BetaContentBlock[]): { url: string; title: string }[] {
  const seen = new Map<string, string>();
  for (const block of content) {
    if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
      for (const r of block.content) if (r.type === "web_search_result") seen.set(r.url, r.title);
    }
    if (block.type === "text" && block.citations) {
      for (const c of block.citations) {
        if (c.type === "web_search_result_location") seen.set(c.url, c.title ?? c.url);
      }
    }
  }
  return [...seen].map(([url, title]) => ({ url, title }));
}

/**
 * Removes things that look like personal data before text goes into a prompt:
 * emails, phone numbers, and street-address lines. Use for buyer messages.
 */
export function redactPii(text: string): string {
  return text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/(\+?\d[\d\s().-]{8,}\d)/g, "[phone]")
    .replace(/\b\d{1,6}\s+[A-Za-z0-9.'\s]{2,40}\b(Street|St|Avenue|Ave|Road|Rd|Lane|Ln|Drive|Dr|Court|Ct|Blvd|Way|Place|Pl)\b\.?/gi, "[address]");
}
