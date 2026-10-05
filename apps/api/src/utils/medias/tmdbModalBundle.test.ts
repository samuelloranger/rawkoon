import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

const cache = new Map<string, unknown>();

mock.module("@rawkoon/api/services/cache", () => ({
  getJsonCache: async (key: string) => cache.get(key) ?? null,
  setJsonCache: async (key: string, value: unknown) => {
    cache.set(key, value);
  },
}));

const { fetchModalTmdbData } = await import("./tmdbModalBundle");

const bundle = {
  overview: "A heist.",
  external_ids: { imdb_id: "tt0000001" },
  images: { backdrops: [] },
  translations: { translations: [] },
  videos: {
    results: [
      { site: "YouTube", type: "Teaser", key: "teaser", name: "Teaser" },
      {
        site: "YouTube",
        type: "Trailer",
        official: true,
        key: "trailer",
        name: "Official Trailer",
      },
    ],
  },
  credits: {
    cast: [{ id: 1, name: "Lead", character: "Hero", profile_path: "/p.jpg" }],
    crew: [{ job: "Director", name: "Auteur" }],
  },
  "watch/providers": {
    results: {
      CA: {
        link: "https://example.test/watch",
        flatrate: [
          { provider_id: 8, provider_name: "Stream", logo_path: "/l.png" },
        ],
      },
    },
  },
};

const omdb = {
  Response: "True",
  imdbRating: "7.5",
  Ratings: [
    { Source: "Rotten Tomatoes", Value: "88%" },
    { Source: "Metacritic", Value: "70/100" },
  ],
};

const originalFetch = globalThis.fetch;
const originalOmdbKey = Bun.env.OMDB_API_KEY;
let calls: URL[] = [];
let failBundle = false;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  cache.clear();
  calls = [];
  failBundle = false;
  Bun.env.OMDB_API_KEY = "omdb-key";
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    calls.push(url);
    if (url.hostname === "www.omdbapi.com") return json(omdb);
    const append = url.searchParams.get("append_to_response") ?? "";
    // The details fetcher appends too; only the combined modal request carries videos.
    const isBundle = append.includes("videos");
    if (isBundle && failBundle) return json({}, 500);
    if (url.pathname.endsWith("/videos")) return json(bundle.videos);
    if (url.pathname.endsWith("/credits")) return json(bundle.credits);
    if (url.pathname.endsWith("/external_ids"))
      return json(bundle.external_ids);
    if (url.pathname.endsWith("/watch/providers")) {
      return json(bundle["watch/providers"]);
    }
    return json(append ? bundle : { overview: "A heist." });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  Bun.env.OMDB_API_KEY = originalOmdbKey;
});

const tmdbCalls = () =>
  calls.filter((u) => u.hostname === "api.themoviedb.org");

describe("fetchModalTmdbData", () => {
  it("fetches every TMDB part in one request on a cold cache", async () => {
    const data = await fetchModalTmdbData("key", "movie", 42, "CA", "fr");

    expect(tmdbCalls()).toHaveLength(1);
    const append = tmdbCalls()[0].searchParams.get("append_to_response");
    expect(append?.split(",").sort()).toEqual(
      [
        "credits",
        "external_ids",
        "images",
        "translations",
        "videos",
        "watch/providers",
      ].sort(),
    );
    expect(tmdbCalls()[0].searchParams.get("language")).toBe("fr-FR");

    expect(data.trailer).toEqual({ key: "trailer", name: "Official Trailer" });
    expect(data.credits.directors).toEqual(["Auteur"]);
    expect(data.credits.cast[0].profile_url).toBe(
      "https://image.tmdb.org/t/p/w185/p.jpg",
    );
    expect(data.providers.streaming.map((p) => p.name)).toEqual(["Stream"]);
    expect(data.providers.link).toBe("https://example.test/watch");
    expect(data.details.overview).toBe("A heist.");
    expect(data.ratings).toEqual({
      imdb_rating: "7.5",
      rotten_tomatoes: "88%",
      metacritic: "70",
    });
  });

  it("serves a warm cache without calling TMDB or OMDb", async () => {
    const first = await fetchModalTmdbData("key", "movie", 42, "CA", "fr");
    calls = [];

    const second = await fetchModalTmdbData("key", "movie", 42, "CA", "fr");

    expect(calls).toHaveLength(0);
    expect(second).toEqual(first);
  });

  it("appends only the parts missing from cache", async () => {
    await fetchModalTmdbData("key", "movie", 42, "CA", "fr");
    cache.delete("medias:credits:movie:42:fr-FR");
    calls = [];

    await fetchModalTmdbData("key", "movie", 42, "CA", "fr");

    expect(tmdbCalls()).toHaveLength(1);
    expect(tmdbCalls()[0].searchParams.get("append_to_response")).toBe(
      "credits",
    );
  });

  it("falls back to per-resource requests when the combined one fails", async () => {
    failBundle = true;

    const data = await fetchModalTmdbData("key", "movie", 42, "CA", "fr");

    expect(data.trailer.key).toBe("trailer");
    expect(data.credits.directors).toEqual(["Auteur"]);
    expect(data.providers.streaming).toHaveLength(1);
    expect(data.ratings.imdb_rating).toBe("7.5");
    expect(tmdbCalls().length).toBeGreaterThan(1);
  });

  it("returns the same payload as the per-resource requests", async () => {
    failBundle = true;
    const perResource = await fetchModalTmdbData(
      "key",
      "movie",
      42,
      "CA",
      "fr",
    );
    cache.clear();
    failBundle = false;

    const bundled = await fetchModalTmdbData("key", "movie", 42, "CA", "fr");

    expect(bundled).toEqual(perResource);
  });

  it("does not refetch when only ratings are missing and OMDb is unconfigured", async () => {
    Bun.env.OMDB_API_KEY = "";
    await fetchModalTmdbData("key", "movie", 42, "CA", "fr");
    calls = [];

    const data = await fetchModalTmdbData("key", "movie", 42, "CA", "fr");

    expect(calls).toHaveLength(0);
    expect(data.ratings).toEqual({
      imdb_rating: null,
      rotten_tomatoes: null,
      metacritic: null,
    });
  });
});
