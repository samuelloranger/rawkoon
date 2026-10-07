import { prisma } from "@rawkoon/api/db";
import type { AiProviderConfig } from "@rawkoon/api/utils/integrations/types";
import type { AiFeature } from "@rawkoon/shared/types";
import { estimateCost } from "@rawkoon/api/services/aiProvider/usageStats";
import {
  recordAiCall,
  type AiCallContext,
} from "@rawkoon/api/services/aiProvider/usageLedger";

export type AiGateReason = "feature_disabled" | "budget_exceeded";

export type AiGateResult =
  | { allowed: true }
  | { allowed: false; reason: AiGateReason };

const SPEND_CACHE_TTL_MS = 60_000;

type Tokens = { input: number; output: number };

let cached: { day: number; at: number; tokens: Tokens } | null = null;

const startOfUtcDay = (ms: number) => ms - (ms % 86_400_000);

/** Called on config save so a new budget or price takes effect immediately. */
export function invalidateAiSpendCache(): void {
  cached = null;
}

/** Adds a just-recorded call to the cached spend so the budget holds within the cache window. */
export function noteAiSpend(
  usage: { inputTokens?: number; outputTokens?: number },
  now = Date.now(),
): void {
  if (!cached || cached.day !== startOfUtcDay(now)) return;
  cached.tokens = {
    input: cached.tokens.input + (usage.inputTokens ?? 0),
    output: cached.tokens.output + (usage.outputTokens ?? 0),
  };
}

/** Uncached; also feeds the stats page so both agree on what "today" is. */
export async function fetchTodayTokens(now = Date.now()): Promise<Tokens> {
  const sums = await prisma.aiCall.aggregate({
    _sum: { inputTokens: true, outputTokens: true },
    where: { createdAt: { gte: new Date(startOfUtcDay(now)) } },
  });
  return {
    input: sums._sum.inputTokens ?? 0,
    output: sums._sum.outputTokens ?? 0,
  };
}

async function todayTokens(now: number): Promise<Tokens> {
  const day = startOfUtcDay(now);
  if (cached && cached.day === day && now - cached.at < SPEND_CACHE_TTL_MS) {
    return cached.tokens;
  }
  const fetched = await fetchTodayTokens(now);
  // Today's totals only grow, so a lookup that started before a noted call
  // must not shrink the cache back below it.
  const prior = cached?.day === day ? cached.tokens : null;
  const tokens = {
    input: Math.max(fetched.input, prior?.input ?? 0),
    output: Math.max(fetched.output, prior?.output ?? 0),
  };
  cached = { day, at: now, tokens };
  return tokens;
}

/** The single check every AI caller goes through, via pickReleaseWithAi. */
export async function checkAiAllowed(
  config: AiProviderConfig,
  feature: AiFeature,
  now = Date.now(),
): Promise<AiGateResult> {
  if (config.features?.[feature] === false) {
    return { allowed: false, reason: "feature_disabled" };
  }

  const budget = config.daily_budget_usd;
  const prices = {
    input: config.input_price_per_million,
    output: config.output_price_per_million,
  };
  // Without a price there is no spend to compare against the budget.
  if (budget == null || (prices.input == null && prices.output == null)) {
    return { allowed: true };
  }

  const tokens = await todayTokens(now);
  const spend = estimateCost(tokens.input, tokens.output, prices) ?? 0;
  return spend >= budget
    ? { allowed: false, reason: "budget_exceeded" }
    : { allowed: true };
}

/** Checks the gate and, for a budget stop, leaves a ledger row so the page shows it. */
export async function gateAiCall(
  config: AiProviderConfig,
  ctx: AiCallContext,
): Promise<AiGateResult> {
  const result = await checkAiAllowed(config, ctx.feature);
  if (!result.allowed && result.reason === "budget_exceeded") {
    recordAiCall({
      ctx,
      model: config.model,
      structured: false,
      status: "budget_skipped",
      durationMs: 0,
    });
  }
  return result;
}
