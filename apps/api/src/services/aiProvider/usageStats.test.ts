import { describe, it, expect, mock } from "bun:test";

const metric = {
  calls: 4,
  ok: 3,
  invalid_pick: 1,
  rate_limited: 0,
  error: 0,
  agreement_checked: 2,
  agreed: 1,
  input_tokens: 2_000_000,
  output_tokens: 1_000_000,
  total_tokens: 3_000_000,
  avg_duration_ms: 400,
  p50_duration_ms: 350,
  p95_duration_ms: 900,
};

const queryRaw = mock(async (strings: TemplateStringsArray) => {
  const sql = strings.join("?");
  if (sql.includes("FROM download_history")) {
    return [
      { ai_picked: true, total: 10, completed: 7, failed: 1, active: 2 },
      { ai_picked: false, total: 5, completed: 5, failed: 0, active: 0 },
    ];
  }
  if (sql.includes("date_trunc")) {
    return [
      {
        day: "2026-10-06",
        calls: 4,
        errors: 1,
        rate_limited: 2,
        input_tokens: 2_000_000,
        output_tokens: 1_000_000,
        total_tokens: 3_000_000,
      },
    ];
  }
  if (sql.includes("GROUP BY feature"))
    return [{ feature: "release_pick_rss", ...metric }];
  if (sql.includes("GROUP BY trigger")) return [{ trigger: "rss", ...metric }];
  if (sql.includes("GROUP BY model")) return [{ model: "m", ...metric }];
  return [metric];
});

const findMany = mock(async () => [
  {
    id: 2,
    feature: "release_pick_interactive",
    model: "m",
    structured: true,
    status: "ok",
    error: null,
    inputTokens: 1_000_000,
    outputTokens: 0,
    totalTokens: 1_000_000,
    durationMs: 120,
    mediaId: 9,
    bookEditionId: null,
    trigger: "interactive",
    classicTitle: "Other",
    agreedWithClassic: false,
    pickedTitle: "Release",
    reasoning: "why",
    createdAt: new Date("2026-10-06T12:00:00Z"),
  },
]);

mock.module("@rawkoon/api/db", () => ({
  prisma: {
    $queryRaw: queryRaw,
    aiCall: { count: mock(async () => 1), findMany },
    libraryMedia: {
      findMany: mock(async () => [{ id: 9, title: "A Movie", type: "movie" }]),
    },
    bookEdition: { findMany: mock(async () => []) },
  },
}));

const { getAiStats, listAiCalls, estimateCost } = await import(
  "@rawkoon/api/services/aiProvider/usageStats"
);

const now = new Date("2026-10-06T15:00:00Z");

describe("estimateCost", () => {
  it("is null with no prices and per-million otherwise", () => {
    expect(estimateCost(10, 10, {})).toBeNull();
    expect(estimateCost(2_000_000, 1_000_000, { input: 0.5, output: 1 })).toBe(
      2,
    );
  });
});

describe("getAiStats", () => {
  it("aggregates totals, per-feature, per-model, grabs and zero-filled days", async () => {
    const stats = await getAiStats(7, { input: 0.5, output: 1 }, now);

    expect(stats.totals).toMatchObject({
      calls: 4,
      ok: 3,
      success_rate: 0.75,
      p95_duration_ms: 900,
      estimated_cost: 2,
    });
    expect(stats.by_feature[0]).toMatchObject({
      feature: "release_pick_rss",
      estimated_cost: 2,
    });
    expect(stats.by_model[0]?.model).toBe("m");
    expect(stats.by_trigger[0]).toMatchObject({
      trigger: "rss",
      agreement_rate: 0.5,
    });
    expect(stats.totals.agreement_rate).toBe(0.5);
    expect(stats.daily[6]?.rate_limited).toBe(2);
    expect(stats.daily).toHaveLength(7);
    expect(stats.daily[0]).toMatchObject({ date: "2026-09-30", calls: 0 });
    expect(stats.daily[6]).toMatchObject({
      date: "2026-10-06",
      calls: 4,
      errors: 1,
      estimated_cost: 2,
    });
    expect(stats.grabs.ai).toEqual({
      total: 10,
      completed: 7,
      failed: 1,
      active: 2,
    });
    expect(stats.grabs.classic.total).toBe(5);
    expect(stats.prices_configured).toBe(true);
  });

  it("reports a null cost when no prices are set", async () => {
    const stats = await getAiStats(30, {}, now);
    expect(stats.totals.estimated_cost).toBeNull();
    expect(stats.prices_configured).toBe(false);
    expect(stats.daily).toHaveLength(30);
  });
});

describe("listAiCalls", () => {
  it("joins the media title and prices each row", async () => {
    const res = await listAiCalls({
      page: 1,
      pageSize: 25,
      prices: { input: 2 },
    });
    expect(res.total).toBe(1);
    expect(res.calls[0]).toMatchObject({
      media_title: "A Movie",
      media_type: "movie",
      trigger: "interactive",
      agreed_with_classic: false,
      book_title: null,
      estimated_cost: 2,
      created_at: "2026-10-06T12:00:00.000Z",
    });
  });
});
