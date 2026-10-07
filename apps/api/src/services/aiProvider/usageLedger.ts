import { prisma } from "@rawkoon/api/db";
import type { AiCallStatus, AiFeature, AiTrigger } from "@rawkoon/shared/types";

export type AiCallContext = {
  feature: AiFeature;
  trigger?: AiTrigger;
  /** Title the classic scorer would pick, to measure how often the AI disagrees. */
  classicTitle?: string;
  mediaId?: number;
  bookEditionId?: number;
};

export type AiCallRecord = {
  ctx: AiCallContext;
  model: string;
  structured: boolean;
  status: AiCallStatus;
  error?: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
  durationMs: number;
  pickedTitle?: string;
  reasoning?: string;
  agreedWithClassic?: boolean;
};

export const isRateLimited = (error: unknown): boolean =>
  (error as { statusCode?: unknown })?.statusCode === 429;

const MAX_ERROR_LENGTH = 200;

/**
 * Provider errors can echo the request URL, whose query string may carry a
 * credential, so URLs are dropped before the message is stored.
 */
export function sanitizeAiError(error: unknown): string {
  const status =
    typeof (error as { statusCode?: unknown })?.statusCode === "number"
      ? `HTTP ${(error as { statusCode: number }).statusCode}: `
      : "";
  const raw = error instanceof Error ? error.message : String(error);
  const message = raw.replace(/https?:\/\/\S+/gi, "[url]").slice(0, 160);
  return `${status}${message}`.slice(0, MAX_ERROR_LENGTH);
}

/** Fire-and-forget: the grab path must never wait on, or fail because of, the ledger. */
export function recordAiCall(record: AiCallRecord): void {
  try {
    void prisma.aiCall
      .create({
        data: {
          feature: record.ctx.feature,
          model: record.model,
          structured: record.structured,
          status: record.status,
          trigger: record.ctx.trigger ?? null,
          classicTitle: record.ctx.classicTitle ?? null,
          agreedWithClassic: record.agreedWithClassic ?? null,
          error: record.error ?? null,
          inputTokens: record.usage?.inputTokens ?? null,
          outputTokens: record.usage?.outputTokens ?? null,
          totalTokens: record.usage?.totalTokens ?? null,
          durationMs: Math.round(record.durationMs),
          mediaId: record.ctx.mediaId ?? null,
          bookEditionId: record.ctx.bookEditionId ?? null,
          pickedTitle: record.pickedTitle ?? null,
          reasoning: record.reasoning ?? null,
        },
      })
      .catch(warn);
  } catch (error) {
    warn(error);
  }
}

function warn(error: unknown) {
  console.warn(
    "[aiProvider] failed to record AI call:",
    error instanceof Error ? error.message : String(error),
  );
}
