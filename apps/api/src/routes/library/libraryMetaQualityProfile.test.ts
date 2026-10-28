import { beforeEach, describe, expect, it, mock } from "bun:test";

// Changing a downloaded show's quality profile checks its files against the
// new profile, whatever TMDB says about the show still airing.

let existing: Record<string, unknown>;
const downloadedEpisodesFailingProfile = mock(async () => [{ id: 1 }]);

mock.module("@rawkoon/api/middleware/hono/auth", () => ({
  requireAdmin: async (_c: unknown, next: () => Promise<void>) => next(),
  requireUser: async (_c: unknown, next: () => Promise<void>) => next(),
}));
const realMutations = await import(
  "@rawkoon/api/services/library/libraryMetaMutations"
);
const realHelpers = await import(
  "@rawkoon/api/services/mediaGrabber/mediaGrabberHelpers"
);
const realLibraryHelpers = await import("./libraryHelpers");
mock.module("@rawkoon/api/services/library/libraryMetaMutations", () => ({
  ...realMutations,
  findLibraryMedia: async () => existing,
  updateLibraryQualityProfile: async () => existing,
}));
mock.module("@rawkoon/api/services/mediaGrabber/mediaGrabberHelpers", () => ({
  ...realHelpers,
  loadProfileWithFormats: async () => ({ id: 2 }),
  profileToScoreInput: () => ({}),
}));
mock.module("@rawkoon/api/services/upgradeTargets", () => ({
  downloadedEpisodesFailingProfile,
}));
mock.module("./libraryHelpers", () => ({
  ...realLibraryHelpers,
  mapLibraryMedia: (item: { id: number }) => ({ id: item.id }),
}));

const { libraryMetaRoutes } = await import("./libraryMetaRoutes");

async function changeProfile(): Promise<Record<string, unknown>> {
  const res = await libraryMetaRoutes.request(
    "http://localhost/1/quality-profile",
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ quality_profile_id: 2 }),
    },
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as { item: Record<string, unknown> };
  return body.item;
}

describe("PATCH /:id/quality-profile", () => {
  beforeEach(() => {
    downloadedEpisodesFailingProfile.mockClear();
    existing = {
      id: 1,
      type: "show",
      status: "downloaded",
      tmdbStatus: "Returning Series",
      qualityProfileId: 1,
    };
  });

  it("flags needed upgrades for a downloaded show that is still airing", async () => {
    const item = await changeProfile();
    expect(downloadedEpisodesFailingProfile).toHaveBeenCalledTimes(1);
    expect(item.needs_upgrade).toBe(true);
    expect(item.affected_episodes).toBe(1);
  });

  it("does not check a show that is not downloaded", async () => {
    existing.status = "wanted";
    await changeProfile();
    expect(downloadedEpisodesFailingProfile).not.toHaveBeenCalled();
  });
});
