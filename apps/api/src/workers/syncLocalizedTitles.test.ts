import { beforeEach, describe, expect, it, mock } from "bun:test";

const findMedia = mock(async () => [
  { id: 1, tmdbId: 238, type: "movie" },
  { id: 2, tmdbId: 1399, type: "show" },
]);
const write = mock(async () => {});
const getKey = mock(async () => "key" as string | null);
type TmdbDetails = {
  title?: string;
  name?: string;
  original_title: string | null;
  original_name: string | null;
  original_language: string | null;
  translations: unknown;
};

const tmdbFetch = mock(
  async (path: string): Promise<TmdbDetails> => ({
    title: path.startsWith("movie") ? "The Godfather" : undefined,
    name: path.startsWith("tv") ? "Game of Thrones" : undefined,
    original_title: "The Godfather",
    original_name: "Game of Thrones",
    original_language: "en",
    translations: {},
  }),
);

mock.module("@rawkoon/api/services/localizedTitleSync", () => ({
  findMediaNeedingLocalizedTitles: findMedia,
  writeLocalizedTitles: write,
}));
mock.module("@rawkoon/api/utils/medias/libraryHelpers", () => ({
  getLibraryTmdbApiKey: getKey,
  tmdbApiFetch: tmdbFetch,
}));

const { syncLocalizedTitles } = await import(
  "@rawkoon/api/workers/syncLocalizedTitles"
);

describe("syncLocalizedTitles", () => {
  beforeEach(() => {
    write.mockClear();
    tmdbFetch.mockClear();
  });

  it("writes rows for every media returned by the selector", async () => {
    const result = await syncLocalizedTitles(50);
    expect(result.processed).toBe(2);
    expect(result.failed).toBe(0);
    expect(write).toHaveBeenCalledTimes(2);
  });

  it("uses the movie endpoint for movies and the tv endpoint for shows", async () => {
    await syncLocalizedTitles(50);
    const paths = tmdbFetch.mock.calls.map((c) => c[0] as string);
    expect(paths[0]).toBe("movie/238");
    expect(paths[1]).toBe("tv/1399");
  });

  it("does nothing when TMDB is not configured", async () => {
    getKey.mockImplementationOnce(async () => null);
    const result = await syncLocalizedTitles(50);
    expect(result.processed).toBe(0);
    expect(write).not.toHaveBeenCalled();
  });

  it("counts a failing media and keeps going", async () => {
    tmdbFetch.mockImplementationOnce(async () => {
      throw new Error("429");
    });
    const result = await syncLocalizedTitles(50);
    expect(result.failed).toBe(1);
    expect(result.processed).toBe(1);
  });

  it("counts a media with no usable title as failed", async () => {
    tmdbFetch.mockImplementationOnce(async () => ({
      title: undefined,
      name: undefined,
      original_title: null,
      original_name: null,
      original_language: null,
      translations: {},
    }));
    const result = await syncLocalizedTitles(50);
    expect(result.failed).toBe(1);
    expect(result.processed).toBe(1);
  });
});
