import { describe, it, expect, mock } from "bun:test";
import type { NormalizedRelease } from "@rawkoon/api/services/indexerManager/types";
import { pickReleaseForGrab } from "@rawkoon/api/utils/medias/pickReleaseForGrab";

const pickReleaseWithAiMock = mock<
  (
    ...args: unknown[]
  ) => Promise<{ release_key: string; reasoning: string } | null>
>(async () => null);

mock.module("@rawkoon/api/services/aiProvider/client", () => ({
  pickReleaseWithAi: pickReleaseWithAiMock,
}));

function release(guid: string, title: string): NormalizedRelease {
  return {
    guid,
    title,
    indexer: "Test",
    indexerId: 1,
    languages: [],
    protocol: "torrent",
    sizeBytes: 5_000_000_000,
    age: 1,
    seeders: 10,
    leechers: 2,
    rejected: false,
    rejections: [],
    infoUrl: null,
    downloadUrl: `https://example.com/${guid}.torrent`,
    magnetUrl: null,
    infoHash: null,
    tmdbId: null,
    freeleech: false,
  };
}

describe("pickReleaseForGrab", () => {
  it("uses classic pick when AI is disabled", async () => {
    pickReleaseWithAiMock.mockClear();
    const candidates = [
      release("a", "Movie.2020.720p.WEB-DL.x264-G1"),
      release("b", "Movie.2020.1080p.BluRay.x265-G2"),
    ];

    const result = await pickReleaseForGrab({
      candidates,
      profile: null,
      mediaContext: { title: "Movie", year: 2020, type: "movie" },
      aiConfig: null,
    });

    expect(result?.picked_by).toBe("classic");
    expect(pickReleaseWithAiMock).not.toHaveBeenCalled();
  });

  it("falls back to classic when AI returns null", async () => {
    pickReleaseWithAiMock.mockImplementationOnce(async () => null);
    const candidates = [
      release("a", "Movie.2020.720p.WEB-DL.x264-G1"),
      release("b", "Movie.2020.1080p.BluRay.x265-G2"),
    ];

    const result = await pickReleaseForGrab({
      candidates,
      profile: null,
      mediaContext: { title: "Movie", year: 2020, type: "movie" },
      aiConfig: { base_url: "http://localhost:11434", model: "test" },
    });

    expect(result?.picked_by).toBe("classic");
    expect(pickReleaseWithAiMock).toHaveBeenCalled();
  });

  it("uses AI pick when AI returns a valid key", async () => {
    pickReleaseWithAiMock.mockImplementationOnce(async () => ({
      release_key: "b",
      reasoning: "Better quality",
    }));
    const candidates = [
      release("a", "Movie.2020.720p.WEB-DL.x264-G1"),
      release("b", "Movie.2020.1080p.BluRay.x265-G2"),
    ];

    const result = await pickReleaseForGrab({
      candidates,
      profile: null,
      mediaContext: { title: "Movie", year: 2020, type: "movie" },
      aiConfig: { base_url: "http://localhost:11434", model: "test" },
    });

    expect(result?.picked_by).toBe("ai");
    expect(result?.release.guid).toBe("b");
    expect(result?.ai_reasoning).toBe("Better quality");
  });

  it("skips AI when only one qualifying release", async () => {
    pickReleaseWithAiMock.mockClear();
    const candidates = [release("a", "Movie.2020.1080p.BluRay.x265-G2")];

    const result = await pickReleaseForGrab({
      candidates,
      profile: null,
      mediaContext: { title: "Movie", year: 2020, type: "movie" },
      aiConfig: { base_url: "http://localhost:11434", model: "test" },
    });

    expect(result?.picked_by).toBe("classic");
    expect(pickReleaseWithAiMock).not.toHaveBeenCalled();
  });
});
