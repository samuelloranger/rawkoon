import { describe, it, expect, mock, beforeEach } from "bun:test";

// --- prisma mock ---
const findUniqueMedia = mock(async () => null as unknown);
const findUniqueEpisode = mock(async () => null as unknown);
const updateMedia = mock(async () => ({}));
const updateEpisode = mock(async () => ({}));

mock.module("@rawkoon/api/db", () => ({
  prisma: {
    libraryMedia: {
      findUnique: findUniqueMedia,
      update: updateMedia,
    },
    libraryEpisode: {
      findUnique: findUniqueEpisode,
      update: updateEpisode,
    },
  },
}));

// --- searchAndGrab mock ---
const searchAndGrabMock = mock(async () => ({ grabbed: true }));

mock.module("@rawkoon/api/services/mediaGrabberSearch", () => ({
  searchAndGrab: searchAndGrabMock,
}));

describe("upgradeMediaSearch", () => {
  beforeEach(() => {
    findUniqueMedia.mockClear();
    findUniqueEpisode.mockClear();
    updateMedia.mockClear();
    updateEpisode.mockClear();
    searchAndGrabMock.mockClear();
  });

  it("returns early without calling searchAndGrab when media is not found", async () => {
    findUniqueMedia.mockImplementationOnce(async () => null);

    const { upgradeMediaSearch } = await import("./upgradeMediaSearch");
    await upgradeMediaSearch({ mediaId: 99 });

    expect(findUniqueMedia).toHaveBeenCalledTimes(1);
    expect(searchAndGrabMock).not.toHaveBeenCalled();
    expect(updateMedia).not.toHaveBeenCalled();
    expect(updateEpisode).not.toHaveBeenCalled();
  });

  it("reverts libraryEpisode status to 'downloaded' when searchAndGrab returns grabbed:false and episodeId is provided", async () => {
    findUniqueMedia.mockImplementationOnce(async () => ({
      title: "Breaking Bad",
      type: "tv",
      qualityProfileId: 1,
    }));
    findUniqueEpisode.mockImplementationOnce(async () => ({
      season: 3,
      episode: 7,
    }));
    searchAndGrabMock.mockImplementationOnce(async () => ({
      grabbed: false,
      reason: "no release found",
    }));

    const { upgradeMediaSearch } = await import("./upgradeMediaSearch");
    await upgradeMediaSearch({ mediaId: 1, episodeId: 42 });

    expect(searchAndGrabMock).toHaveBeenCalledTimes(1);
    expect(updateEpisode).toHaveBeenCalledTimes(1);
    expect(updateEpisode).toHaveBeenCalledWith({
      where: { id: 42 },
      data: { status: "downloaded" },
    });
    expect(updateMedia).not.toHaveBeenCalled();
  });

  it("reverts libraryMedia status to 'downloaded' when searchAndGrab returns grabbed:false and no episodeId", async () => {
    findUniqueMedia.mockImplementationOnce(async () => ({
      title: "Inception",
      type: "movie",
      qualityProfileId: 2,
    }));
    searchAndGrabMock.mockImplementationOnce(async () => ({
      grabbed: false,
      reason: "no release found",
    }));

    const { upgradeMediaSearch } = await import("./upgradeMediaSearch");
    await upgradeMediaSearch({ mediaId: 7 });

    expect(searchAndGrabMock).toHaveBeenCalledTimes(1);
    expect(updateMedia).toHaveBeenCalledTimes(1);
    expect(updateMedia).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { status: "downloaded" },
    });
    expect(updateEpisode).not.toHaveBeenCalled();
  });

  it("does not revert any status when searchAndGrab returns grabbed:true", async () => {
    findUniqueMedia.mockImplementationOnce(async () => ({
      title: "Dune",
      type: "movie",
      qualityProfileId: 3,
    }));
    searchAndGrabMock.mockImplementationOnce(async () => ({ grabbed: true }));

    const { upgradeMediaSearch } = await import("./upgradeMediaSearch");
    await upgradeMediaSearch({ mediaId: 5 });

    expect(searchAndGrabMock).toHaveBeenCalledTimes(1);
    expect(updateMedia).not.toHaveBeenCalled();
    expect(updateEpisode).not.toHaveBeenCalled();
  });
});
