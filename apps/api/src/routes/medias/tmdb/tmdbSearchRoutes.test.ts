import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";

const findMany = mock(async (_args: unknown) => [
  { tmdbId: 11, type: "movie", id: 5, status: "downloading" },
  // A show sharing a result's TMDB id must not mark the movie as in the library.
  { tmdbId: 12, type: "show", id: 6, status: "downloaded" },
]);

mock.module("@rawkoon/api/db", () => ({
  prisma: { libraryMedia: { findMany } },
}));
mock.module("@rawkoon/api/middleware/hono/auth", () => ({
  requireUser: async (_c: unknown, next: () => Promise<void>) => next(),
}));
mock.module("@rawkoon/api/services/integrationConfigCache", () => ({
  getIntegrationConfigRecord: async () => ({
    enabled: true,
    config: { api_key: "test-key" },
  }),
}));

const { tmdbSearchRoutes } = await import("./tmdbSearchRoutes");

const realFetch = globalThis.fetch;

function tmdbResult(id: number, title: string) {
  return {
    id,
    media_type: "movie",
    title,
    release_date: "2020-01-01",
    poster_path: null,
    overview: "",
    vote_average: 7,
  };
}

describe("GET /tmdb-search", () => {
  beforeEach(() => {
    findMany.mockClear();
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          results: [tmdbResult(11, "In Library"), tmdbResult(12, "Not Yet")],
        }),
      )) as unknown as typeof fetch;
  });

  afterAll(() => {
    globalThis.fetch = realFetch;
  });

  it("reports the library status for a title already in the library", async () => {
    const res = await tmdbSearchRoutes.request(
      "http://localhost/tmdb-search?q=title",
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: {
        tmdb_id: number;
        already_exists: boolean;
        library_id: number | null;
        library_status: string | null;
      }[];
    };
    const byId = new Map(body.items.map((i) => [i.tmdb_id, i]));
    expect(byId.get(11)).toMatchObject({
      already_exists: true,
      library_id: 5,
      library_status: "downloading",
    });
    expect(byId.get(12)).toMatchObject({
      already_exists: false,
      library_id: null,
      library_status: null,
    });
  });

  it("looks the library up once for the whole result list", async () => {
    await tmdbSearchRoutes.request("http://localhost/tmdb-search?q=title");
    expect(findMany).toHaveBeenCalledTimes(1);
  });
});
