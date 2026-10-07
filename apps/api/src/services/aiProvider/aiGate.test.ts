import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";

const aggregate = mock(async (_args?: unknown) => ({
  _sum: { inputTokens: 0, outputTokens: 0 },
}));
const createCall = mock(
  async (_args: { data: Record<string, unknown> }) => ({}),
);
const findFirst = mock(async (_args?: unknown) => null as unknown);

mock.module("@rawkoon/api/db", () => ({
  prisma: {
    aiCall: { aggregate, create: createCall },
    integration: { findFirst },
  },
}));

const { checkAiAllowed, invalidateAiSpendCache, noteAiSpend } = await import(
  "@rawkoon/api/services/aiProvider/aiGate"
);
const { pickReleaseWithAi, pickBookReleaseWithAi } = await import(
  "@rawkoon/api/services/aiProvider/client"
);
const { handleAiPick } = await import("@rawkoon/api/routes/medias/search");
const { invalidateIntegrationConfigCache } = await import(
  "@rawkoon/api/services/integrationConfigCache"
);

const base = { base_url: "http://ai.test", model: "m" };
const priced = {
  ...base,
  input_price_per_million: 1,
  output_price_per_million: 1,
};

/** Spend of `usd` at 1 USD per million input tokens. */
const spend = (usd: number) =>
  aggregate.mockImplementation(async () => ({
    _sum: { inputTokens: usd * 1_000_000, outputTokens: 0 },
  }));

const realFetch = globalThis.fetch;
const fetchSpy = mock(async () => new Response("{}", { status: 500 }));

beforeEach(() => {
  invalidateAiSpendCache();
  invalidateIntegrationConfigCache();
  aggregate.mockClear();
  createCall.mockClear();
  findFirst.mockClear();
  spend(0);
  fetchSpy.mockClear();
  globalThis.fetch = fetchSpy as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("checkAiAllowed", () => {
  it("blocks a disabled feature without touching the database", async () => {
    const res = await checkAiAllowed(
      { ...priced, daily_budget_usd: 5, features: { release_pick_rss: false } },
      "release_pick_rss",
    );
    expect(res).toEqual({ allowed: false, reason: "feature_disabled" });
    expect(aggregate).not.toHaveBeenCalled();
  });

  it("treats a missing feature key as enabled", async () => {
    const res = await checkAiAllowed(
      { ...base, features: { release_pick_rss: false } },
      "book_release_pick",
    );
    expect(res.allowed).toBe(true);
  });

  it("allows everything when no budget is set", async () => {
    spend(1000);
    expect((await checkAiAllowed(priced, "release_pick_rss")).allowed).toBe(
      true,
    );
    expect(aggregate).not.toHaveBeenCalled();
  });

  it("ignores a budget when no price is configured", async () => {
    spend(1000);
    const res = await checkAiAllowed(
      { ...base, daily_budget_usd: 1 },
      "release_pick_rss",
    );
    expect(res.allowed).toBe(true);
  });

  it("allows under budget and blocks at or over it", async () => {
    const config = { ...priced, daily_budget_usd: 2 };
    spend(1);
    expect((await checkAiAllowed(config, "release_pick_rss")).allowed).toBe(
      true,
    );
    invalidateAiSpendCache();
    spend(2);
    expect(await checkAiAllowed(config, "release_pick_rss")).toEqual({
      allowed: false,
      reason: "budget_exceeded",
    });
  });

  it("caches today's spend for 60 s and re-reads after, or after invalidation", async () => {
    const config = { ...priced, daily_budget_usd: 2 };
    const t0 = Date.UTC(2026, 9, 6, 12, 0, 0);
    spend(1);
    await checkAiAllowed(config, "release_pick_rss", t0);
    spend(5);
    const cachedRes = await checkAiAllowed(
      config,
      "release_pick_rss",
      t0 + 59_000,
    );
    expect(cachedRes.allowed).toBe(true);
    expect(aggregate).toHaveBeenCalledTimes(1);

    const expired = await checkAiAllowed(
      config,
      "release_pick_rss",
      t0 + 61_000,
    );
    expect(expired.allowed).toBe(false);
    expect(aggregate).toHaveBeenCalledTimes(2);

    spend(0);
    invalidateAiSpendCache();
    const fresh = await checkAiAllowed(config, "release_pick_rss", t0 + 62_000);
    expect(fresh.allowed).toBe(true);
    expect(aggregate).toHaveBeenCalledTimes(3);
  });

  it("counts calls recorded inside the cache window", async () => {
    const config = { ...priced, daily_budget_usd: 2 };
    const t0 = Date.UTC(2026, 9, 6, 12, 0, 0);
    spend(1);
    expect((await checkAiAllowed(config, "release_pick_rss", t0)).allowed).toBe(
      true,
    );
    noteAiSpend({ inputTokens: 1_500_000, outputTokens: 0 }, t0 + 1_000);
    const res = await checkAiAllowed(config, "release_pick_rss", t0 + 2_000);
    expect(res).toEqual({ allowed: false, reason: "budget_exceeded" });
    expect(aggregate).toHaveBeenCalledTimes(1);
  });

  it("starts the spend window at midnight UTC", async () => {
    const now = Date.UTC(2026, 9, 6, 15, 30);
    await checkAiAllowed(
      { ...priced, daily_budget_usd: 1 },
      "release_pick_rss",
      now,
    );
    const arg = aggregate.mock.calls[0]?.[0] as {
      where: { createdAt: { gte: Date } };
    };
    expect(arg.where.createdAt.gte.toISOString()).toBe(
      "2026-10-06T00:00:00.000Z",
    );
  });
});

const releases = [
  { key: "a", title: "A", size_bytes: null, seeders: 5, score: 1 },
];
const media = { title: "Movie", year: 2024, type: "movie" as const };

describe("pickReleaseWithAi gating", () => {
  it("makes no HTTP call and writes no row for a disabled feature", async () => {
    const res = await pickReleaseWithAi(
      { ...priced, features: { release_pick_rss: false } },
      media,
      releases,
      { feature: "release_pick_rss" },
    );
    expect(res).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(createCall).not.toHaveBeenCalled();
  });

  it("makes no HTTP call and writes one budget_skipped row when over budget", async () => {
    spend(3);
    const res = await pickReleaseWithAi(
      { ...priced, daily_budget_usd: 1 },
      media,
      releases,
      { feature: "release_pick_rss", trigger: "rss", mediaId: 4 },
    );
    expect(res).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(createCall).toHaveBeenCalledTimes(1);
    expect(createCall.mock.calls[0]?.[0].data).toMatchObject({
      feature: "release_pick_rss",
      status: "budget_skipped",
      totalTokens: null,
      durationMs: 0,
      mediaId: 4,
    });
  });

  it("gates book picks through the same check", async () => {
    const res = await pickBookReleaseWithAi(
      { ...priced, features: { book_release_pick: false } },
      {
        title: "Book",
        authors: ["A"],
        kind: "audiobook",
        language: "fr",
        seriesName: null,
        seriesPosition: null,
      },
      [
        {
          ...releases[0]!,
          format: "m4b",
          kind: "audiobook",
          language: "fr",
          audio_bitrate: null,
        },
      ],
      { feature: "book_release_pick" },
    );
    expect(res).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("falls back to classic without an HTTP call when the spend lookup fails", async () => {
    aggregate.mockImplementation(async () => {
      throw new Error("db down");
    });
    const res = await pickReleaseWithAi(
      { ...priced, daily_budget_usd: 1 },
      media,
      releases,
      { feature: "release_pick_rss" },
    );
    expect(res).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("handleAiPick", () => {
  const body = {
    media_context: { title: "Movie", year: 2024, type: "movie" as const },
    releases: [
      { key: "a", title: "A", size_bytes: null, seeders: 1, score: 1 },
    ],
  };
  const stored = (extra: Record<string, unknown>) =>
    findFirst.mockImplementation(async () => ({
      enabled: true,
      config: { ...base, ...extra },
    }));

  it("404s when the interactive feature is off", async () => {
    stored({ features: { release_pick_interactive: false } });
    expect((await handleAiPick(body)).status).toBe(404);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("429s with a distinct message when the budget is spent", async () => {
    stored({
      input_price_per_million: 1,
      output_price_per_million: 1,
      daily_budget_usd: 1,
    });
    spend(2);
    const res = await handleAiPick(body);
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "AI daily budget reached" });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(createCall).toHaveBeenCalledTimes(1);
  });
});
