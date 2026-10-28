import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";

// Re-running the Sonarr migration refreshes a downloaded show's status from
// its files, whether or not TMDB still lists the show as airing.

let existing: { id: number; status: string; tmdbStatus?: string } | null;
const upsert = mock(async (_args: unknown) => ({ id: 1 }));

mock.module("@rawkoon/api/db", () => ({
  prisma: { libraryMedia: { findUnique: async () => existing, upsert } },
}));

const realArrHelpers = await import(
  "@rawkoon/api/services/jobs/libraryMigrateArrHelpers"
);
mock.module("@rawkoon/api/services/jobs/libraryMigrateArrHelpers", () => ({
  ...realArrHelpers,
  tmdbFetch: async () => ({ tv_results: [{ id: 99 }] }),
}));

const { migrateFromSonarr } = await import(
  "@rawkoon/api/services/jobs/libraryMigrateSonarr"
);

const realFetch = globalThis.fetch;
afterAll(() => {
  globalThis.fetch = realFetch;
});

function series(episodeFileCount: number) {
  return [
    {
      id: 5,
      title: "Some Show",
      tvdbId: 123,
      year: 2020,
      overview: "",
      images: [],
      seasons: [{ statistics: { episodeFileCount } }],
    },
  ];
}

async function migrate(episodeFileCount: number): Promise<string> {
  globalThis.fetch = (async (url: string) =>
    String(url).includes("/series")
      ? Response.json(series(episodeFileCount))
      : new Response("nope", { status: 500 })) as unknown as typeof fetch;
  await migrateFromSonarr("http://sonarr", "key", {
    tmdbConfig: { api_key: "k" },
    defaultMovieQualityProfileId: null,
    defaultShowQualityProfileId: null,
    region: "US",
    progress: {} as never,
    result: {} as never,
    push: async () => {},
  } as never);
  const args = upsert.mock.calls.at(-1)?.[0] as {
    update: { status: string };
  };
  return args.update.status;
}

describe("migrateFromSonarr show status", () => {
  beforeEach(() => upsert.mockClear());

  it("re-derives the status of a downloaded show from its files", async () => {
    existing = { id: 1, status: "downloaded", tmdbStatus: "Returning Series" };
    expect(await migrate(0)).toBe("wanted");
    expect(await migrate(3)).toBe("downloaded");
  });

  it("leaves a show that is downloading alone", async () => {
    existing = { id: 1, status: "downloading" };
    expect(await migrate(3)).toBe("downloading");
  });
});
