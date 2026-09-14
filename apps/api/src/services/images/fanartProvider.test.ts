import { describe, expect, it, mock } from "bun:test";

type IntegrationRecord = {
  enabled: boolean;
  config: Record<string, unknown>;
} | null;

const getRecord = mock(
  async (): Promise<IntegrationRecord> => ({
    enabled: true,
    config: { api_key: "enc:k" },
  }),
);
mock.module("@rawkoon/api/services/integrationConfigCache", () => ({
  getIntegrationConfigRecord: getRecord,
}));
mock.module("@rawkoon/api/utils/integrations/normalizers", () => ({
  normalizeFanartConfig: (c: unknown) =>
    (c as { api_key?: string })?.api_key ? { api_key: "k" } : null,
}));

const { parseFanartImages, fetchFanartArtwork } = await import(
  "@rawkoon/api/services/images/fanartProvider"
);

const movieRaw = {
  movieposter: [
    { id: "1", url: "https://f/p1.jpg", lang: "en", likes: "3" },
    { id: "2", url: "https://f/p2.jpg", lang: "", likes: "9" },
  ],
  moviebackground: [
    { id: "3", url: "https://f/b1.jpg", lang: "fr", likes: "1" },
  ],
};

const showRaw = {
  tvposter: [{ id: "4", url: "https://f/tp.jpg", lang: "fr", likes: "2" }],
  showbackground: [{ id: "5", url: "https://f/sb.jpg", lang: "", likes: "7" }],
};

describe("parseFanartImages", () => {
  it("maps movie posters, sorted by likes", () => {
    const out = parseFanartImages(movieRaw, "poster");
    expect(out.map((c) => c.url)).toEqual([
      "https://f/p2.jpg",
      "https://f/p1.jpg",
    ]);
    expect(out[0].source).toBe("fanart");
    expect(out[0].vote).toBe(9);
  });

  it("treats an empty lang as language-neutral", () => {
    expect(parseFanartImages(movieRaw, "poster")[0].language).toBeNull();
  });

  it("uses the url as its own thumbnail", () => {
    const c = parseFanartImages(movieRaw, "poster")[0];
    expect(c.thumb_url).toBe(c.url);
  });

  it("reports no dimensions", () => {
    const c = parseFanartImages(movieRaw, "poster")[0];
    expect(c.width).toBeNull();
    expect(c.height).toBeNull();
  });

  it("reads the show keys too", () => {
    expect(parseFanartImages(showRaw, "poster")[0].url).toBe(
      "https://f/tp.jpg",
    );
    expect(parseFanartImages(showRaw, "backdrop")[0].url).toBe(
      "https://f/sb.jpg",
    );
  });

  it("returns an empty list for a malformed payload", () => {
    expect(parseFanartImages(null, "poster")).toEqual([]);
    expect(parseFanartImages({ movieposter: "no" }, "poster")).toEqual([]);
  });
});

describe("fetchFanartArtwork", () => {
  it("returns nothing when the provider id is missing", async () => {
    const out = await fetchFanartArtwork({
      mediaType: "tv",
      providerId: null,
      kind: "poster",
    });
    expect(out).toEqual([]);
  });

  it("returns nothing when the integration is disabled", async () => {
    getRecord.mockImplementationOnce(async () => ({
      enabled: false,
      config: { api_key: "enc:k" },
    }));
    const out = await fetchFanartArtwork({
      mediaType: "movie",
      providerId: 238,
      kind: "poster",
    });
    expect(out).toEqual([]);
  });

  it("returns nothing when no key is configured", async () => {
    getRecord.mockImplementationOnce(async () => ({
      enabled: true,
      config: {},
    }));
    const out = await fetchFanartArtwork({
      mediaType: "movie",
      providerId: 238,
      kind: "poster",
    });
    expect(out).toEqual([]);
  });

  it("returns nothing and does not throw when the request fails", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    try {
      const out = await fetchFanartArtwork({
        mediaType: "movie",
        providerId: 238,
        kind: "poster",
      });
      expect(out).toEqual([]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("returns nothing on a non-2xx response", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response("not found", { status: 404 })) as unknown as typeof fetch;
    try {
      const out = await fetchFanartArtwork({
        mediaType: "movie",
        providerId: 999,
        kind: "poster",
      });
      expect(out).toEqual([]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("parses a successful response", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      Response.json(movieRaw)) as unknown as typeof fetch;
    try {
      const out = await fetchFanartArtwork({
        mediaType: "movie",
        providerId: 238,
        kind: "poster",
      });
      expect(out.map((c) => c.url)).toEqual([
        "https://f/p2.jpg",
        "https://f/p1.jpg",
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
