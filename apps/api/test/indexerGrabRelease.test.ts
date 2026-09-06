import { afterEach, describe, expect, it, mock } from "bun:test";
import { ProwlarrAdapter } from "../src/services/indexerManager/prowlarrAdapter";
import { JackettAdapter } from "../src/services/indexerManager/jackettAdapter";

const FAKE_CONFIG = {
  website_url: "http://prowlarr.local",
  api_key: "test-key",
};

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
});

function fakeRelease(overrides: Record<string, unknown> = {}) {
  return {
    guid: "g1",
    title: "Movie.2024.1080p",
    indexer: "tracker-a",
    indexerId: 1,
    languages: [],
    protocol: "torrent",
    sizeBytes: 1,
    age: 1,
    seeders: 1,
    leechers: 0,
    rejected: false,
    rejections: [],
    infoUrl: null,
    downloadUrl: "https://indexer.example/dl.torrent",
    magnetUrl: null,
    infoHash: null,
    tmdbId: null,
    freeleech: false,
    ...overrides,
  };
}

describe("indexer grabRelease resolves a URL without pushing to Prowlarr", () => {
  it("Prowlarr extracts the download URL from the stored payload", async () => {
    const fetchMock = mock(async () => new Response("nope", { status: 500 }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const adapter = new ProwlarrAdapter(FAKE_CONFIG as never);
    const token = adapter.storeReleaseToken(
      fakeRelease({
        rawPayload: {
          title: "Movie.2024.1080p",
          indexer: "tracker-a",
          downloadUrl: "https://indexer.example/dl.torrent",
        },
      }),
    );
    expect(token).toBeTruthy();
    const result = await adapter.grabRelease(token!);
    expect(result).toEqual({
      success: true,
      downloadUrl: "https://indexer.example/dl.torrent",
      title: "Movie.2024.1080p",
      indexer: "tracker-a",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Jackett returns the stored magnet and title", async () => {
    const adapter = new JackettAdapter(FAKE_CONFIG as never);
    const token = adapter.storeReleaseToken(
      fakeRelease({
        magnetUrl:
          "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567",
        downloadUrl: null,
      }),
    );
    expect(token).toBeTruthy();
    const result = await adapter.grabRelease(token!);
    expect(result.success).toBe(true);
    expect(result.magnetUrl).toStartWith("magnet:");
    expect(result.title).toBe("Movie.2024.1080p");
  });
});
