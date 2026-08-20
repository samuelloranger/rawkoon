import { describe, it, expect, beforeEach, mock } from "bun:test";

// The book half of the RSS sweep grabs without anyone asking, so its filters are
// what stand between a feed and a wrong file in the library: the categories it
// asks for, the reject filter, and the kind re-check (a tracker files audiobooks
// under Books, so a passing title is not enough).

type Release = {
  title: string;
  sizeBytes: number;
  seeders: number;
  indexer: string;
  downloadUrl: string | null;
  magnetUrl: string | null;
};

const state: {
  booksEnabled: boolean;
  wanted: Array<{ id: number }>;
  releases: Release[];
  fetchArgs: Array<{ indexers: string[]; categories?: string[] }>;
  fetchThrows: Error | null;
  context: Record<string, unknown> | null;
  scores: Record<string, { rejected: boolean; kind: string; score: number }>;
  grabCalls: Array<Record<string, unknown>>;
} = {
  booksEnabled: true,
  wanted: [],
  releases: [],
  fetchArgs: [],
  fetchThrows: null,
  context: null,
  scores: {},
  grabCalls: [],
};

mock.module("@rawkoon/api/db", () => ({
  prisma: {
    appSettings: {
      findUnique: () => Promise.resolve({ booksEnabled: state.booksEnabled }),
    },
    bookEdition: {
      findMany: () => Promise.resolve(state.wanted),
    },
  },
}));

const realGrabber = await import("@rawkoon/api/services/books/bookGrabber");
mock.module("@rawkoon/api/services/books/bookGrabber", () => ({
  ...realGrabber,
  loadEditionContext: () => Promise.resolve(state.context),
  grabBookRelease: (opts: Record<string, unknown>) => {
    state.grabCalls.push(opts);
    return Promise.resolve({ grabbed: true, releaseTitle: opts.releaseTitle });
  },
}));

const realScorer = await import("@rawkoon/api/utils/books/bookReleaseScorer");
mock.module("@rawkoon/api/utils/books/bookReleaseScorer", () => ({
  ...realScorer,
  // Keyed by release title so each test states the verdict it wants without
  // depending on the parser's judgement of a made-up release name.
  scoreBookRelease: (candidate: { title: string }) => {
    const verdict = state.scores[candidate.title] ?? {
      rejected: true,
      kind: "ebook",
      score: 0,
    };
    return {
      ...verdict,
      parsed: {},
      rejections: verdict.rejected ? ["Title does not match"] : [],
    };
  },
}));

const { pollIndexerRssBooks } = await import(
  "@rawkoon/api/workers/pollIndexerRssBooks"
);

const adapter = {
  fetchRss: (indexers: string[], categories?: string[]) => {
    state.fetchArgs.push({ indexers, categories });
    if (state.fetchThrows) return Promise.reject(state.fetchThrows);
    return Promise.resolve(state.releases);
  },
} as unknown as Parameters<typeof pollIndexerRssBooks>[0];

const release = (over: Partial<Release> = {}): Release => ({
  title: "Release A",
  sizeBytes: 1_000_000,
  seeders: 10,
  indexer: "test",
  downloadUrl: "magnet:?xt=urn:btih:1",
  magnetUrl: null,
  ...over,
});

const ebookContext = {
  editionId: 1,
  kind: "ebook",
  bookTitle: "A Quiet Harbour",
  authors: ["Camille Rousseau"],
  bookLanguage: "fr",
  profile: { allowedFormats: ["epub"] },
};

describe("pollIndexerRssBooks", () => {
  beforeEach(() => {
    state.booksEnabled = true;
    state.wanted = [{ id: 1 }];
    state.releases = [release()];
    state.fetchArgs = [];
    state.fetchThrows = null;
    state.context = ebookContext;
    state.scores = {
      "Release A": { rejected: false, kind: "ebook", score: 50 },
    };
    state.grabCalls = [];
  });

  it("does not even fetch when books are disabled", async () => {
    state.booksEnabled = false;

    const stats = await pollIndexerRssBooks(adapter, ["idx"]);

    expect(state.fetchArgs).toEqual([]);
    expect(stats).toEqual({ found: 0, grabbed: 0 });
  });

  // Both categories, because a tracker files an audiobook under either.
  it("asks for the book and audio categories", async () => {
    await pollIndexerRssBooks(adapter, ["idx"]);

    expect(state.fetchArgs).toHaveLength(1);
    expect(state.fetchArgs[0]?.categories).toEqual(["7000", "3000"]);
    expect(state.fetchArgs[0]?.indexers).toEqual(["idx"]);
  });

  it("skips the fetch entirely when nothing is wanted", async () => {
    state.wanted = [];

    const stats = await pollIndexerRssBooks(adapter, ["idx"]);

    expect(state.fetchArgs).toEqual([]);
    expect(stats).toEqual({ found: 0, grabbed: 0 });
  });

  it("grabs a matching release and counts it", async () => {
    const stats = await pollIndexerRssBooks(adapter, ["idx"]);

    expect(state.grabCalls).toHaveLength(1);
    expect(state.grabCalls[0]?.editionId).toBe(1);
    expect(state.grabCalls[0]?.releaseTitle).toBe("Release A");
    expect(stats).toEqual({ found: 1, grabbed: 1 });
  });

  it("grabs nothing when the reject filter turns everything down", async () => {
    state.scores = {};

    const stats = await pollIndexerRssBooks(adapter, ["idx"]);

    expect(state.grabCalls).toEqual([]);
    expect(stats).toEqual({ found: 1, grabbed: 0 });
  });

  // The filter that a title match alone cannot provide.
  it("refuses an audiobook release for an ebook edition", async () => {
    state.scores = {
      "Release A": { rejected: false, kind: "audiobook", score: 90 },
    };

    await pollIndexerRssBooks(adapter, ["idx"]);

    expect(state.grabCalls).toEqual([]);
  });

  it("takes the highest-scoring release of several matches", async () => {
    state.releases = [
      release({ title: "Release A" }),
      release({ title: "Release B" }),
      release({ title: "Release C" }),
    ];
    state.scores = {
      "Release A": { rejected: false, kind: "ebook", score: 10 },
      "Release B": { rejected: false, kind: "ebook", score: 80 },
      "Release C": { rejected: false, kind: "ebook", score: 40 },
    };

    await pollIndexerRssBooks(adapter, ["idx"]);

    expect(state.grabCalls).toHaveLength(1);
    expect(state.grabCalls[0]?.releaseTitle).toBe("Release B");
  });

  it("ignores a matching release with nothing to download", async () => {
    state.releases = [release({ downloadUrl: null, magnetUrl: null })];

    await pollIndexerRssBooks(adapter, ["idx"]);

    expect(state.grabCalls).toEqual([]);
  });

  it("reports zero rather than throwing when the RSS fetch fails", async () => {
    state.fetchThrows = new Error("indexer down");

    const stats = await pollIndexerRssBooks(adapter, ["idx"]);

    expect(stats).toEqual({ found: 0, grabbed: 0 });
  });
});
