import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { ArtworkCandidate } from "@rawkoon/shared/types";

const tmdb: ArtworkCandidate = {
  url: "tmdb-poster",
  thumb_url: "tmdb-poster",
  width: null,
  height: null,
  language: null,
  vote: 1,
  source: "tmdb",
};
const fanart: ArtworkCandidate = {
  ...tmdb,
  url: "fanart-poster",
  thumb_url: "fanart-poster",
  source: "fanart",
};

let fanartEnabled = false;
let fanartKey = "first-key";
const cache = new Map<string, ArtworkCandidate[]>();

mock.module("@rawkoon/api/services/cache", () => ({
  getJsonCache: async (key: string) => cache.get(key) ?? null,
  setJsonCache: async (key: string, value: ArtworkCandidate[]) => {
    cache.set(key, value);
  },
}));
mock.module("@rawkoon/api/services/integrationConfigCache", () => ({
  getIntegrationConfigRecord: async () => ({
    enabled: fanartEnabled,
    config: { api_key: fanartKey },
  }),
}));
mock.module("@rawkoon/api/utils/medias/libraryHelpers", () => ({
  getLibraryTmdbApiKey: async () => "tmdb-key",
}));
mock.module("@rawkoon/api/services/images/tmdbImageProvider", () => ({
  fetchTmdbArtwork: async () => [tmdb],
}));
mock.module("@rawkoon/api/services/images/fanartProvider", () => ({
  fetchFanartArtwork: async () =>
    fanartEnabled ? [{ ...fanart, url: fanartKey }] : [],
}));

const { getArtworkCandidates } = await import("./artworkService");
const input = {
  tmdbId: 238,
  mediaType: "movie" as const,
  kind: "poster" as const,
};

describe("artwork candidate cache", () => {
  beforeEach(() => {
    cache.clear();
    fanartEnabled = false;
    fanartKey = "first-key";
  });

  it("includes fanart candidates immediately after enabling the integration", async () => {
    const before = await getArtworkCandidates(input);
    expect(before.map((c) => c.source)).toEqual(["tmdb"]);
    fanartEnabled = true;
    const after = await getArtworkCandidates(input);
    expect(after.map((c) => c.source)).toEqual(["tmdb", "fanart"]);
  });

  it("removes fanart candidates immediately after disabling the integration", async () => {
    fanartEnabled = true;
    const before = await getArtworkCandidates(input);
    expect(before.map((c) => c.source)).toEqual(["tmdb", "fanart"]);
    fanartEnabled = false;
    const after = await getArtworkCandidates(input);
    expect(after.map((c) => c.source)).toEqual(["tmdb"]);
  });

  it("uses the new fanart key after the integration is reconfigured", async () => {
    fanartEnabled = true;
    const before = await getArtworkCandidates(input);
    expect(before[1]?.url).toBe("first-key");
    fanartKey = "second-key";
    const after = await getArtworkCandidates(input);
    expect(after[1]?.url).toBe("second-key");
  });
});
