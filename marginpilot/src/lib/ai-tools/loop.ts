import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { AI_TOOLS, FALLBACK_MODELS, MODELS, estimateCostUsd, type AiToolKey, type ModelTier } from "@/config/ai";
import { createAdminClient } from "@/lib/supabase/admin";
import { aiCreditBalance, creditPeriodStart } from "@/lib/limits";
import type { AiErrorCode, AiResult } from "@/lib/ai/run";

/**
 * Multi-turn client tool loop (for the store assistant chat), built the same way
 * as runAi(): credit check first, model picked by tool tier, refusal fallback,
 * one ai_requests row per assistant turn, credits charged only on success, and the
 * same typed error results. runAi() covers single calls and server tools; this
 * adds read-only client tools that run in our code between model turns.
 */

let client: Anthropic | null = null;
function anthropic() {
  if (!client) client = new Anthropic({ maxRetries: 2 });
  return client;
}

// Same wording as runAi so users see one voice.
export const AI_ERROR_MESSAGES: Record<AiErrorCode, string> = {
  no_credits: "You've used this month's AI credits. They reset on the 1st, or upgrade your plan for more.",
  rate_limited: "The AI service is busy right now. Please try again in a minute.",
  unavailable: "The AI service is temporarily unavailable. Please try again shortly.",
  refused: "The AI declined this request. Try rewording it or removing unusual content.",
  bad_request: "That request couldn't be processed. Check the input and try again.",
  not_configured: "AI isn't configured yet. Add ANTHROPIC_API_KEY.",
  failed: "Something went wrong generating this answer. Please try again.",
};

export type LocalTool = {
  definition: Anthropic.Beta.BetaTool;
  /** Validates its own input and returns a JSON string for the model. Never throws for bad input. */
  run: (input: unknown) => Promise<string>;
};

export type ToolCallLog = { name: string; input: unknown; ok: boolean };

export type RunToolsOptions = {
  orgId: string;
  userId: string | null;
  storeId?: string | null;
  tool: AiToolKey;
  tier?: ModelTier;
  system: string;
  messages: Anthropic.Beta.BetaMessageParam[];
  tools: LocalTool[];
  /** Model round trips allowed in one assistant turn. */
  maxIterations?: number;
  maxTokens?: number;
  credits?: number;
};

export type ToolLoopResult = AiResult<string> & { toolCalls?: ToolCallLog[] };

export function mapAiError(err: unknown): AiErrorCode {
  if (err instanceof Anthropic.RateLimitError) return "rate_limited";
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) return "not_configured";
  if (err instanceof Anthropic.BadRequestError) return "bad_request";
  if (err instanceof Anthropic.InternalServerError || err instanceof Anthropic.APIConnectionError) return "unavailable";
  if (err instanceof Anthropic.APIError && (err.status === 529 || err.status === 503)) return "unavailable";
  return "failed";
}

export async function runAiWithTools(opts: RunToolsOptions): Promise<ToolLoopResult> {
  const toolCfg = AI_TOOLS[opts.tool];
  const model = MODELS[opts.tier ?? toolCfg.tier];
  const credits = opts.credits ?? toolCfg.credits;
  const db = createAdminClient();
  const toolCalls: ToolCallLog[] = [];
  const lastUser = opts.messages.filter((m) => m.role === "user").at(-1);
  const prompt = { system: opts.system, messages: opts.messages, tools: opts.tools.map((t) => t.definition.name) };

  async function log(row: Record<string, unknown>) {
    const { data } = await db
      .from("ai_requests")
      .insert({ org_id: opts.orgId, user_id: opts.userId, store_id: opts.storeId ?? null, tool: opts.tool, model, prompt, ...row })
      .select("id")
      .single();
    return data?.id as string | undefined;
  }

  if (!process.env.ANTHROPIC_API_KEY) return { ok: false, error: "not_configured", message: AI_ERROR_MESSAGES.not_configured };
  if (!lastUser) return { ok: false, error: "bad_request", message: AI_ERROR_MESSAGES.bad_request };

  const balance = await aiCreditBalance(opts.orgId);
  if (balance.remaining < credits) return { ok: false, error: "no_credits", message: AI_ERROR_MESSAGES.no_credits };

  const base = {
    model,
    max_tokens: opts.maxTokens ?? 4000,
    system: [{ type: "text" as const, text: opts.system, cache_control: { type: "ephemeral" as const } }],
    output_config: { effort: "medium" as const },
    tools: opts.tools.map((t) => t.definition),
    ...(FALLBACK_MODELS.has(model) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
  };
  const byName = new Map(opts.tools.map((t) => [t.definition.name, t]));

  let inputTokens = 0, outputTokens = 0, cacheRead = 0;
  const usage = () => ({
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cache_read_tokens: cacheRead,
    cost_usd: estimateCostUsd(model, { input: inputTokens, output: outputTokens, cacheRead }),
  });

  try {
    const messages: Anthropic.Beta.BetaMessageParam[] = [...opts.messages];
    const allContent: Anthropic.Beta.BetaContentBlock[] = [];
    let finalText = "";
    let lastModel = model;
    let finished = false;

    for (let i = 0; i < (opts.maxIterations ?? 6); i++) {
      const res = await anthropic().beta.messages.create({ ...base, messages } as Anthropic.Beta.MessageCreateParamsNonStreaming);
      inputTokens += res.usage.input_tokens;
      outputTokens += res.usage.output_tokens;
      cacheRead += res.usage.cache_read_input_tokens ?? 0;
      lastModel = res.model;
      allContent.push(...res.content);

      if (res.stop_reason === "refusal") {
        const id = await log({ status: "refused", error: res.stop_details?.category ?? "refusal", credits: 0, output: { toolCalls }, ...usage() });
        return { ok: false, error: "refused", message: AI_ERROR_MESSAGES.refused, requestId: id };
      }

      const text = res.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");

      if (res.stop_reason === "pause_turn") {
        messages.push({ role: "assistant", content: res.content });
        continue;
      }

      const uses = res.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
      if (res.stop_reason !== "tool_use" || uses.length === 0) {
        finalText = text;
        finished = true;
        break;
      }

      messages.push({ role: "assistant", content: res.content });
      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      for (const use of uses) {
        const t = byName.get(use.name);
        let content: string;
        let ok = true;
        if (!t) {
          ok = false;
          content = JSON.stringify({ error: `Unknown tool ${use.name}` });
        } else {
          try {
            content = await t.run(use.input);
            ok = !content.startsWith('{"error"');
          } catch {
            ok = false;
            content = JSON.stringify({ error: "The data lookup failed. Tell the user to try again." });
          }
        }
        toolCalls.push({ name: use.name, input: use.input, ok });
        results.push({ type: "tool_result", tool_use_id: use.id, content, ...(ok ? {} : { is_error: true }) });
      }
      messages.push({ role: "user", content: results });
    }

    if (!finished) {
      finalText =
        (finalText ? finalText + "\n\n" : "") +
        "I looked up several things but ran out of steps before finishing. Try a narrower question.";
    }

    const id = await log({ status: "ok", output: { text: finalText, toolCalls }, credits, ...usage() });
    await db.from("ai_credit_ledger").insert({
      org_id: opts.orgId,
      period_start: creditPeriodStart(),
      delta: -credits,
      reason: opts.tool,
      ai_request_id: id ?? null,
    });
    return { ok: true, requestId: id ?? "", output: finalText, text: finalText, content: allContent, model: lastModel, toolCalls };
  } catch (err) {
    const code = mapAiError(err);
    const id = await log({
      status: code === "rate_limited" ? "rate_limited" : "error",
      error: err instanceof Error ? err.message.slice(0, 500) : String(err),
      credits: 0,
      output: { toolCalls },
      ...usage(),
    });
    return { ok: false, error: code, message: AI_ERROR_MESSAGES[code], requestId: id, toolCalls };
  }
}
