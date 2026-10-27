import { beforeEach, describe, expect, it, mock } from "bun:test";
import { Hono } from "hono";
import type { ExportLibraryResponse } from "@rawkoon/shared/types";

const findMany = mock(async (_args: unknown): Promise<unknown[]> => []);
const verifyApiKey = mock(async (_args: unknown) => ({ valid: true }));

mock.module("@rawkoon/api/db", () => ({
  prisma: { libraryMedia: { findMany } },
}));
mock.module("@rawkoon/api/lib/apiKeyApi", () => ({
  apiKeyApi: { verifyApiKey },
}));

const { exportRoutes } = await import("./index");
const app = new Hono().route("/api/export", exportRoutes);

const get = (path: string, key: string | null = "k") =>
  app.request(
    new Request(`http://localhost/api/export${path}`, {
      headers: key ? { "x-api-key": key } : {},
    }),
  );

const updatedAt = new Date("2026-01-02T03:04:05.000Z");

const baseRow = {
  tmdbId: 10,
  originalTitle: "Orig",
  originalLanguage: "fr",
  year: 2020,
  overview: "Stored overview",
  posterUrl: "/stored.jpg",
  overrides: null,
  updatedAt,
  files: [],
  episodes: [],
  downloadHistories: [],
};

const fileRow = {
  id: 7,
  episodeId: null,
  filePath: "/lib/a.mkv",
  fileName: "a.mkv",
  sizeBytes: 9007199254740993n,
  durationSecs: 60,
  releaseGroup: "GRP",
  source: "bluray",
  resolution: 1080,
  videoCodec: "h264",
  videoProfile: null,
  hdrFormat: null,
  bitDepth: 8,
  width: 1920,
  height: 1080,
  frameRate: 24,
  audioFormat: "aac",
  audioTracks: [{ lang: "fr" }],
  subtitleTracks: [],
  languageTags: ["fr"],
  episode: null,
};

describe("Export API", () => {
  beforeEach(() => {
    findMany.mockClear();
    verifyApiKey.mockClear();
    verifyApiKey.mockImplementation(async () => ({ valid: true }));
    findMany.mockImplementation(async () => []);
  });

  it("rejects a missing api key", async () => {
    const res = await get("/library", null);
    expect(res.status).toBe(401);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("rejects an invalid api key", async () => {
    verifyApiKey.mockImplementation(async () => ({ valid: false }));
    const res = await get("/library");
    expect(res.status).toBe(401);
  });

  it("rejects an out-of-range limit", async () => {
    const res = await get("/library?limit=201");
    expect(res.status).toBe(400);
  });

  it("maps a movie with overrides, string size and no episodes", async () => {
    findMany.mockImplementation(async () => [
      {
        ...baseRow,
        id: 1,
        type: "movie",
        title: "Stored",
        overrides: { title: "Override", year: 1999, poster_url: "/o.jpg" },
        files: [fileRow],
        downloadHistories: [
          {
            releaseTitle: "Rel.Name",
            torrentHash: "abc",
            indexer: "idx",
            season: null,
            episodeId: null,
            completedAt: updatedAt,
          },
        ],
      },
    ]);

    const body = (await (
      await get("/library")
    ).json()) as ExportLibraryResponse;
    expect(body).toMatchObject({ page: 1, limit: 100, has_more: false });
    const [item] = body.items;
    expect(item).toMatchObject({
      id: 1,
      tmdb_id: 10,
      type: "movie",
      title: "Override",
      year: 1999,
      poster_url: "/o.jpg",
      overview: "Stored overview",
      original_title: "Orig",
      updated_at: updatedAt.toISOString(),
      episodes: [],
    });
    expect(item.files[0]).toMatchObject({
      size_bytes: "9007199254740993",
      season: null,
      episode: null,
      language_tags: ["fr"],
    });
    expect(item.downloads[0]).toMatchObject({
      release_title: "Rel.Name",
      completed_at: updatedAt.toISOString(),
    });
  });

  it("maps show episodes and file season/episode", async () => {
    findMany.mockImplementation(async () => [
      {
        ...baseRow,
        id: 2,
        type: "show",
        title: "Show",
        files: [
          { ...fileRow, episodeId: 5, episode: { season: 2, episode: 3 } },
        ],
        episodes: [
          {
            id: 5,
            season: 2,
            episode: 3,
            airDate: new Date("2024-05-06T00:00:00.000Z"),
            status: "downloaded",
          },
        ],
      },
    ]);

    const [item] = (
      (await (await get("/library")).json()) as ExportLibraryResponse
    ).items;
    expect(item.files[0]).toMatchObject({
      episode_id: 5,
      season: 2,
      episode: 3,
    });
    expect(item.episodes).toEqual([
      {
        id: 5,
        season: 2,
        episode: 3,
        air_date: "2024-05-06",
        status: "downloaded",
      },
    ]);
  });

  it("paginates and reports has_more from the extra row", async () => {
    findMany.mockImplementation(async () =>
      [1, 2, 3].map((id) => ({
        ...baseRow,
        id,
        type: "movie",
        title: `T${id}`,
      })),
    );

    const body = (await (
      await get("/library?page=3&limit=2")
    ).json()) as ExportLibraryResponse;
    expect(body.items.map((i: { id: number }) => i.id)).toEqual([1, 2]);
    expect(body.has_more).toBe(true);
    expect(body).toMatchObject({ page: 3, limit: 2 });
    expect(findMany.mock.calls[0]?.[0]).toMatchObject({ skip: 4, take: 3 });
  });
});
