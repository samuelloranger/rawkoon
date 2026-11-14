import { beforeEach, describe, expect, it, mock } from "bun:test";

type Row = {
  id: number;
  tmdbId: number;
  type: string;
  factsFetchedAt: Date | null;
  voteCount?: number | null;
  genreIds?: number[];
};

const rows: Row[] = [];
const calls: number[] = [];
const concurrent = { now: 0, max: 0 };
const failures = new Map<number, number>();
let key: string | null = "k";
let autoJoinCalls = 0;

mock.module("@rawkoon/api/db", () => ({
  prisma: {
    libraryMedia: {
      findMany: async (args: {
        where: { factsFetchedAt: null | { lt: Date } };
        take: number;
      }) => {
        const lt = args.where.factsFetchedAt;
        return rows
          .filter((r) =>
            lt === null
              ? r.factsFetchedAt === null
              : r.factsFetchedAt !== null && r.factsFetchedAt < lt.lt,
          )
          .slice(0, args.take);
      },
      update: async (args: { where: { id: number }; data: Partial<Row> }) => {
        Object.assign(
          rows.find((r) => r.id === args.where.id) as Row,
          args.data,
        );
      },
    },
  },
}));
mock.module("@rawkoon/api/utils/medias/libraryHelpers", () => ({
  getLibraryTmdbApiKey: async () => key,
  tmdbApiFetch: async (path: string) => {
    const id = Number(path.split("/")[1]);
    calls.push(id);
    concurrent.now++;
    concurrent.max = Math.max(concurrent.max, concurrent.now);
    await new Promise((r) => setTimeout(r, 2));
    concurrent.now--;
    const status = failures.get(id);
    if (status) throw new Error(`TMDB ${path} → ${status}`);
    return { genres: [{ id: 27 }], vote_count: 10, vote_average: 6 };
  },
}));
mock.module("@rawkoon/api/utils/medias/tmdbRegion", () => ({
  getGlobalTmdbRegion: async () => "US",
}));
mock.module("./shelfRulesService", () => ({
  autoJoinShelves: async () => {
    autoJoinCalls++;
    return { shelves: 0, added: 0 };
  },
}));

const { runTitleFactsSweep } = await import("./titleFactsSweep");

const OLD = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
const fast = { delayMs: 0, concurrency: 2 };

beforeEach(() => {
  rows.length = 0;
  calls.length = 0;
  failures.clear();
  concurrent.now = concurrent.max = 0;
  key = "k";
  autoJoinCalls = 0;
});

describe("title facts sweep", () => {
  it("does nothing without a TMDB key", async () => {
    key = null;
    rows.push({ id: 1, tmdbId: 1, type: "movie", factsFetchedAt: null });
    const result = await runTitleFactsSweep(fast);
    expect(result.filled).toBe(0);
    expect(calls).toEqual([]);
    expect(autoJoinCalls).toBe(0);
  });

  it("fills unfetched titles in small concurrent batches up to the cap", async () => {
    for (let id = 1; id <= 7; id++) {
      rows.push({ id, tmdbId: id, type: "movie", factsFetchedAt: null });
    }
    const result = await runTitleFactsSweep({ ...fast, maxTitles: 5 });
    expect(result.filled).toBe(5);
    expect(calls.sort()).toEqual([1, 2, 3, 4, 5]);
    expect(concurrent.max).toBeLessThanOrEqual(2);
    expect(rows[0]?.genreIds).toEqual([27]);
    expect(rows[6]?.factsFetchedAt).toBeNull();
    expect(autoJoinCalls).toBe(1);
  });

  it("refreshes only the votes of rows older than 30 days", async () => {
    rows.push(
      { id: 1, tmdbId: 1, type: "movie", factsFetchedAt: OLD, genreIds: [35] },
      { id: 2, tmdbId: 2, type: "movie", factsFetchedAt: new Date() },
    );
    const result = await runTitleFactsSweep(fast);
    expect(result).toMatchObject({ filled: 0, refreshed: 1 });
    expect(calls).toEqual([1]);
    expect(rows[0]?.voteCount).toBe(10);
    expect(rows[0]?.genreIds).toEqual([35]);
  });

  it("stores a title TMDB no longer has as fetched and retries other failures later", async () => {
    rows.push(
      { id: 1, tmdbId: 1, type: "movie", factsFetchedAt: null },
      { id: 2, tmdbId: 2, type: "movie", factsFetchedAt: null },
    );
    failures.set(1, 404);
    failures.set(2, 500);
    const result = await runTitleFactsSweep(fast);
    expect(result).toMatchObject({ filled: 1, failed: 1 });
    expect(rows[0]?.factsFetchedAt).not.toBeNull();
    expect(rows[1]?.factsFetchedAt).toBeNull();
  });

  it("stops at a rate limit, leaving the rest for the next run", async () => {
    for (let id = 1; id <= 6; id++) {
      rows.push({ id, tmdbId: id, type: "show", factsFetchedAt: null });
      failures.set(id, 429);
    }
    const result = await runTitleFactsSweep(fast);
    expect(result.rateLimited).toBe(true);
    expect(calls.length).toBe(2);
  });
});
