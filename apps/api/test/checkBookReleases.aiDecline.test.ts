import { afterAll, describe, expect, it, mock } from "bun:test";

const searchCalls: number[] = [];
const grabCalls: unknown[] = [];

mock.module("@rawkoon/api/db", () => ({
  prisma: {
    appSettings: { findUnique: () => Promise.resolve({ booksEnabled: true }) },
    bookEdition: {
      findMany: () =>
        Promise.resolve([
          {
            id: 9,
            files: [{ format: "pdf" }],
            bookQualityProfile: {
              allowedFormats: ["epub", "azw3", "pdf"],
              cutoffFormat: "epub",
            },
          },
        ]),
    },
  },
}));

const realGrabber = {
  ...(await import("@rawkoon/api/services/books/bookGrabber")),
};
const release = (title: string) => ({
  title,
  format: "epub",
  rejected: false,
  download_url: `magnet:?xt=urn:btih:${title}`,
  magnet_url: null,
  indexer: "test",
  score: 10,
});
mock.module("@rawkoon/api/services/books/bookGrabber", () => ({
  ...realGrabber,
  loadEditionContext: () => Promise.resolve({}),
  searchBookReleases: (editionId: number) => {
    searchCalls.push(editionId);
    return Promise.resolve({ releases: [release("A"), release("B")] });
  },
  grabBookRelease: (opts: unknown) => {
    grabCalls.push(opts);
    return Promise.resolve({ grabbed: true });
  },
}));

const realAiPick = {
  ...(await import("@rawkoon/api/services/books/bookAiPick")),
};
mock.module("@rawkoon/api/services/books/bookAiPick", () => ({
  ...realAiPick,
  pickBookCandidate: () => Promise.resolve({ pick: null, aiPicked: true }),
}));

const cache = new Map<string, { value: unknown; ttl: number }>();
const realCache = { ...(await import("@rawkoon/api/services/cache")) };
mock.module("@rawkoon/api/services/cache", () => ({
  ...realCache,
  getJsonCache: (key: string) => Promise.resolve(cache.get(key)?.value ?? null),
  setJsonCache: (key: string, value: unknown, ttl: number) => {
    cache.set(key, { value, ttl });
    return Promise.resolve();
  },
}));

// mock.module is process-wide; give the real modules back to later files.
afterAll(() => {
  mock.module("@rawkoon/api/services/books/bookGrabber", () => realGrabber);
  mock.module("@rawkoon/api/services/books/bookAiPick", () => realAiPick);
  mock.module("@rawkoon/api/services/cache", () => realCache);
});

const { searchBookUpgrades, UPGRADE_SEARCH_COOLDOWN_S } = await import(
  "@rawkoon/api/workers/checkBookReleases"
);

describe("searchBookUpgrades with an AI judge that declines", () => {
  // Otherwise a judge that turns every upgrade down is paid again each sweep.
  it("grabs nothing and rests the edition like an empty search", async () => {
    await searchBookUpgrades();
    await searchBookUpgrades();

    expect(grabCalls).toEqual([]);
    expect(searchCalls).toEqual([9]);
    expect(cache.get("books:upgrade-searched:9")?.ttl).toBe(
      UPGRADE_SEARCH_COOLDOWN_S,
    );
  });
});
