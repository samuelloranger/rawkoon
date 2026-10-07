import { Prisma } from "@prisma/client";
import { prisma } from "@rawkoon/api/db";
import type {
  AiCallEntry,
  AiCallsResponse,
  AiCallStatus,
  AiDailyStats,
  AiGrabOutcome,
  AiStatsResponse,
  AiUsageMetrics,
} from "@rawkoon/shared/types";

export type AiPrices = { input?: number; output?: number };

type MetricsRow = {
  calls: number;
  ok: number;
  invalid_pick: number;
  rate_limited: number;
  error: number;
  agreement_checked: number;
  agreed: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  avg_duration_ms: number | null;
  p50_duration_ms: number | null;
  p95_duration_ms: number | null;
};

const DAY_MS = 86_400_000;

export function estimateCost(
  inputTokens: number,
  outputTokens: number,
  prices: AiPrices,
): number | null {
  if (prices.input == null && prices.output == null) return null;
  return (
    (inputTokens * (prices.input ?? 0) + outputTokens * (prices.output ?? 0)) /
    1_000_000
  );
}

function toMetrics(row: MetricsRow, prices: AiPrices): AiUsageMetrics {
  return {
    calls: row.calls,
    ok: row.ok,
    invalid_pick: row.invalid_pick,
    rate_limited: row.rate_limited,
    error: row.error,
    agreement_checked: row.agreement_checked,
    agreement_rate:
      row.agreement_checked > 0 ? row.agreed / row.agreement_checked : null,
    success_rate: row.calls > 0 ? row.ok / row.calls : 0,
    input_tokens: row.input_tokens,
    output_tokens: row.output_tokens,
    total_tokens: row.total_tokens,
    avg_duration_ms: row.avg_duration_ms,
    p50_duration_ms: row.p50_duration_ms,
    p95_duration_ms: row.p95_duration_ms,
    estimated_cost: estimateCost(row.input_tokens, row.output_tokens, prices),
  };
}

const EMPTY_ROW: MetricsRow = {
  calls: 0,
  ok: 0,
  invalid_pick: 0,
  rate_limited: 0,
  error: 0,
  agreement_checked: 0,
  agreed: 0,
  input_tokens: 0,
  output_tokens: 0,
  total_tokens: 0,
  avg_duration_ms: null,
  p50_duration_ms: null,
  p95_duration_ms: null,
};

// float8 casts keep Postgres bigint/numeric out of JSON as BigInt or strings.
const METRIC_COLUMNS = Prisma.sql`
  count(*)::float8 AS calls,
  (count(*) FILTER (WHERE status = 'ok'))::float8 AS ok,
  (count(*) FILTER (WHERE status = 'invalid_pick'))::float8 AS invalid_pick,
  (count(*) FILTER (WHERE status = 'rate_limited'))::float8 AS rate_limited,
  (count(*) FILTER (WHERE status = 'error'))::float8 AS error,
  (count(*) FILTER (WHERE agreed_with_classic IS NOT NULL))::float8 AS agreement_checked,
  (count(*) FILTER (WHERE agreed_with_classic))::float8 AS agreed,
  coalesce(sum(input_tokens), 0)::float8 AS input_tokens,
  coalesce(sum(output_tokens), 0)::float8 AS output_tokens,
  coalesce(sum(total_tokens), 0)::float8 AS total_tokens,
  avg(duration_ms)::float8 AS avg_duration_ms,
  (percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms))::float8 AS p50_duration_ms,
  (percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms))::float8 AS p95_duration_ms`;

function zeroFilledDays(
  days: number,
  rows: Array<{
    day: string;
    calls: number;
    errors: number;
    rate_limited: number;
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
  }>,
  prices: AiPrices,
  now: Date,
): AiDailyStats[] {
  const byDay = new Map(rows.map((r) => [r.day, r]));
  const today = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  const out: AiDailyStats[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(today - i * DAY_MS).toISOString().slice(0, 10);
    const row = byDay.get(date);
    out.push({
      date,
      calls: row?.calls ?? 0,
      errors: row?.errors ?? 0,
      rate_limited: row?.rate_limited ?? 0,
      total_tokens: row?.total_tokens ?? 0,
      estimated_cost: estimateCost(
        row?.input_tokens ?? 0,
        row?.output_tokens ?? 0,
        prices,
      ),
    });
  }
  return out;
}

type GrabRow = {
  ai_picked: boolean;
  total: number;
  completed: number;
  failed: number;
  active: number;
};

function toGrabOutcome(row: GrabRow | undefined): AiGrabOutcome {
  return {
    total: row?.total ?? 0,
    completed: row?.completed ?? 0,
    failed: row?.failed ?? 0,
    active: row?.active ?? 0,
  };
}

export async function getAiStats(
  days: number,
  prices: AiPrices,
  now = new Date(),
): Promise<AiStatsResponse> {
  // Window starts at the first zero-filled day so the chart and totals agree.
  const startOfToday = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  const since = new Date(startOfToday - (days - 1) * DAY_MS);

  const [totals, byFeature, byModel, byTrigger, daily, grabs] =
    await Promise.all([
      prisma.$queryRaw<MetricsRow[]>`
      SELECT ${METRIC_COLUMNS} FROM ai_calls WHERE created_at >= ${since}`,
      prisma.$queryRaw<Array<MetricsRow & { feature: string }>>`
      SELECT feature, ${METRIC_COLUMNS} FROM ai_calls
      WHERE created_at >= ${since} GROUP BY feature ORDER BY calls DESC`,
      prisma.$queryRaw<Array<MetricsRow & { model: string }>>`
      SELECT model, ${METRIC_COLUMNS} FROM ai_calls
      WHERE created_at >= ${since} GROUP BY model ORDER BY calls DESC`,
      prisma.$queryRaw<Array<MetricsRow & { trigger: string | null }>>`
      SELECT trigger, ${METRIC_COLUMNS} FROM ai_calls
      WHERE created_at >= ${since} GROUP BY trigger ORDER BY calls DESC`,
      prisma.$queryRaw<
        Array<{
          day: string;
          calls: number;
          errors: number;
          rate_limited: number;
          input_tokens: number;
          output_tokens: number;
          total_tokens: number;
        }>
      >`
      SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
        count(*)::float8 AS calls,
        (count(*) FILTER (WHERE status IN ('error', 'invalid_pick')))::float8 AS errors,
        (count(*) FILTER (WHERE status = 'rate_limited'))::float8 AS rate_limited,
        coalesce(sum(input_tokens), 0)::float8 AS input_tokens,
        coalesce(sum(output_tokens), 0)::float8 AS output_tokens,
        coalesce(sum(total_tokens), 0)::float8 AS total_tokens
      FROM ai_calls WHERE created_at >= ${since} GROUP BY 1`,
      prisma.$queryRaw<GrabRow[]>`
      SELECT ai_picked,
        count(*)::float8 AS total,
        (count(*) FILTER (WHERE completed_at IS NOT NULL AND NOT failed))::float8 AS completed,
        (count(*) FILTER (WHERE failed))::float8 AS failed,
        (count(*) FILTER (WHERE completed_at IS NULL AND NOT failed))::float8 AS active
      FROM download_history WHERE grabbed_at >= ${since} GROUP BY ai_picked`,
    ]);

  return {
    days,
    totals: toMetrics(totals[0] ?? EMPTY_ROW, prices),
    by_feature: byFeature.map((r) => ({
      feature: r.feature,
      ...toMetrics(r, prices),
    })),
    by_model: byModel.map((r) => ({ model: r.model, ...toMetrics(r, prices) })),
    by_trigger: byTrigger.map((r) => ({
      trigger: r.trigger,
      ...toMetrics(r, prices),
    })),
    daily: zeroFilledDays(days, daily, prices, now),
    grabs: {
      ai: toGrabOutcome(grabs.find((g) => g.ai_picked)),
      classic: toGrabOutcome(grabs.find((g) => !g.ai_picked)),
    },
    prices_configured: prices.input != null || prices.output != null,
  };
}

export async function listAiCalls(opts: {
  page: number;
  pageSize: number;
  feature?: string;
  status?: AiCallStatus;
  prices: AiPrices;
}): Promise<AiCallsResponse> {
  const where: Prisma.AiCallWhereInput = {
    ...(opts.feature ? { feature: opts.feature } : {}),
    ...(opts.status ? { status: opts.status } : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.aiCall.count({ where }),
    prisma.aiCall.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (opts.page - 1) * opts.pageSize,
      take: opts.pageSize,
    }),
  ]);

  const mediaIds = [...new Set(rows.flatMap((r) => r.mediaId ?? []))];
  const editionIds = [...new Set(rows.flatMap((r) => r.bookEditionId ?? []))];
  const [media, editions] = await Promise.all([
    mediaIds.length
      ? prisma.libraryMedia.findMany({
          where: { id: { in: mediaIds } },
          select: { id: true, title: true, type: true },
        })
      : [],
    editionIds.length
      ? prisma.bookEdition.findMany({
          where: { id: { in: editionIds } },
          select: { id: true, bookId: true, book: { select: { title: true } } },
        })
      : [],
  ]);
  const mediaById = new Map(media.map((m) => [m.id, m]));
  const editionById = new Map(editions.map((e) => [e.id, e]));

  const calls: AiCallEntry[] = rows.map((r) => {
    const m = r.mediaId != null ? mediaById.get(r.mediaId) : undefined;
    const e =
      r.bookEditionId != null ? editionById.get(r.bookEditionId) : undefined;
    return {
      id: r.id,
      feature: r.feature,
      model: r.model,
      structured: r.structured,
      status: r.status as AiCallStatus,
      trigger: r.trigger,
      classic_title: r.classicTitle,
      agreed_with_classic: r.agreedWithClassic,
      error: r.error,
      input_tokens: r.inputTokens,
      output_tokens: r.outputTokens,
      total_tokens: r.totalTokens,
      duration_ms: r.durationMs,
      estimated_cost:
        r.inputTokens == null && r.outputTokens == null
          ? null
          : estimateCost(r.inputTokens ?? 0, r.outputTokens ?? 0, opts.prices),
      media_id: r.mediaId,
      media_title: m?.title ?? null,
      media_type: m?.type ?? null,
      book_id: e?.bookId ?? null,
      book_edition_id: r.bookEditionId,
      book_title: e?.book.title ?? null,
      picked_title: r.pickedTitle,
      reasoning: r.reasoning,
      created_at: r.createdAt.toISOString(),
    };
  });

  return { calls, total, page: opts.page, page_size: opts.pageSize };
}
