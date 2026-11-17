import { beforeEach, describe, expect, it, mock } from "bun:test";

const updateMedia = mock(async (_args: unknown) => ({}));
mock.module("@rawkoon/api/db", () => ({
  prisma: { libraryMedia: { update: updateMedia } },
}));

type Outcome = Record<string, unknown>;
const fallback = mock(
  async (_opts: Outcome): Promise<Outcome> => ({
    grabbed: false,
    reason: "No matching releases found",
  }),
);
const direct = mock(
  async (_opts: Outcome): Promise<Outcome> => ({
    grabbed: false,
    reason: "No matching releases found",
  }),
);
mock.module("@rawkoon/api/services/mediaGrabber/mediaGrabberSearch", () => ({
  searchAndGrabWithTitleFallback: fallback,
  searchAndGrab: direct,
}));

const { searchLibraryTarget, targetSuffix } = await import(
  "./searchLibraryTarget"
);

const media = {
  id: 7,
  title: "Show",
  searchTitle: "Le Show",
  originalTitle: "Show",
  year: 2020,
  qualityProfileId: 1,
};

function setOutcome(o: Outcome) {
  fallback.mockImplementationOnce(async () => o);
  direct.mockImplementationOnce(async () => o);
}

describe("searchLibraryTarget", () => {
  beforeEach(() => {
    updateMedia.mockClear();
    fallback.mockClear();
    direct.mockClear();
  });

  it("formats the suffix per target kind", () => {
    expect(targetSuffix(media, { kind: "movie" })).toBe(" 2020");
    expect(targetSuffix({ year: null }, { kind: "movie" })).toBe("");
    expect(targetSuffix(media, { kind: "season", season: 3 })).toBe(" S03");
    expect(
      targetSuffix(media, {
        kind: "episode",
        episodeId: 1,
        season: 3,
        episode: 12,
      }),
    ).toBe(" S03E12");
    expect(targetSuffix(media, { kind: "show" })).toBe("");
  });

  it("searches every title with the target suffix", async () => {
    await searchLibraryTarget(
      media,
      { kind: "season", season: 2 },
      { trigger: "scheduled" },
    );
    expect(fallback.mock.calls[0]?.[0]).toMatchObject({
      titleBaseQueries: ["Le Show", "Show"],
      suffix: " S02",
      season: 2,
      mediaType: "tv",
    });
  });

  it("lets an explicit query override the titles", async () => {
    await searchLibraryTarget(
      media,
      { kind: "movie" },
      { trigger: "manual_search", query: "exact words" },
    );
    expect(fallback).not.toHaveBeenCalled();
    expect(direct.mock.calls[0]?.[0]).toMatchObject({
      searchQuery: "exact words",
      mediaType: "movie",
    });
  });

  it("does not persist an episode outcome but persists a season one", async () => {
    await searchLibraryTarget(
      media,
      { kind: "episode", episodeId: 5, season: 1, episode: 2 },
      { trigger: "manual_search" },
    );
    expect(updateMedia).not.toHaveBeenCalled();

    await searchLibraryTarget(
      media,
      { kind: "season", season: 1 },
      { trigger: "manual_search" },
    );
    expect(updateMedia).toHaveBeenCalledTimes(1);
  });

  it("leaves publishing to the caller with publish:false", async () => {
    const out = await searchLibraryTarget(
      media,
      { kind: "movie" },
      { trigger: "scheduled", publish: false },
    );
    expect(updateMedia).not.toHaveBeenCalled();
    expect(out.payload.outcome).toBe("no_match");
  });

  it("counts a plain miss but not delayed, no-space, active or grabbed outcomes", async () => {
    const run = async (o: Outcome) => {
      setOutcome(o);
      return (
        await searchLibraryTarget(
          media,
          { kind: "movie" },
          { trigger: "scheduled", publish: false },
        )
      ).countsAsMiss;
    };
    expect(await run({ grabbed: false, reason: "x" })).toBe(true);
    expect(await run({ grabbed: false, delayed: true, reason: "x" })).toBe(
      false,
    );
    expect(
      await run({ grabbed: false, reason: "x", refusal: "no_space" }),
    ).toBe(false);
    expect(
      await run({ grabbed: false, reason: "x", refusal: "already_active" }),
    ).toBe(false);
    expect(await run({ grabbed: true, releaseTitle: "R" })).toBe(false);
  });
});
