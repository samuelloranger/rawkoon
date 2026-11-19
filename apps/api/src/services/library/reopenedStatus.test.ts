import { beforeEach, describe, expect, it, mock } from "bun:test";

let files: Array<{ filePath: string }> = [];
const mediaUpdate = mock(async (_arg: unknown) => ({}));
const mediaUpdateMany = mock(async (_arg: unknown) => ({ count: 2 }));
const episodeUpdate = mock(async (_arg: unknown) => ({}));
const episodeUpdateMany = mock(async (_arg: unknown) => ({ count: 1 }));
const dhCount = mock(async (_arg: unknown) => 0);

mock.module("@rawkoon/api/db", () => ({
  prisma: {
    mediaFile: { findMany: async () => files },
    libraryMedia: { update: mediaUpdate, updateMany: mediaUpdateMany },
    libraryEpisode: { update: episodeUpdate, updateMany: episodeUpdateMany },
    downloadHistory: { count: dhCount },
  },
}));
mock.module("@rawkoon/api/services/queueService", () => ({
  addJob: async () => {},
  QUEUE_NAMES: {},
  SCHEDULED_JOB_NAMES: {},
}));

const {
  resetMovieForManualSearch,
  resetEpisodeForManualSearch,
  retrySkippedEpisodes,
} = await import("./libraryGrabQueries");
const { updateLibraryStatus, setEpisodeStatus } = await import(
  "./libraryMetaMutations"
);
const { revertToWantedIfNoActiveGrabs } = await import(
  "@rawkoon/api/services/downloads/downloadOutcome"
);
const { healWantedWithFiles } = await import("./healWantedWithFiles");

// stat() succeeds for the test runner's own entry point.
const onDisk = [{ filePath: import.meta.path }];
const statusOf = (m: { mock: { calls: unknown[][] } }) =>
  (m.mock.calls[0]![0] as { data: { status: string } }).data.status;

beforeEach(() => {
  files = [];
  for (const m of [
    mediaUpdate,
    mediaUpdateMany,
    episodeUpdate,
    episodeUpdateMany,
  ]) {
    m.mockClear();
  }
});

describe("writers that reopen a movie or episode", () => {
  it("manual-search reset keeps a movie with a file downloaded", async () => {
    files = onDisk;
    await resetMovieForManualSearch(1);
    expect(statusOf(mediaUpdate)).toBe("downloaded");
  });

  it("manual-search reset makes a movie without a file wanted", async () => {
    await resetMovieForManualSearch(1);
    expect(statusOf(mediaUpdate)).toBe("wanted");
  });

  it("manual-search reset keeps an episode with a file downloaded", async () => {
    files = onDisk;
    await resetEpisodeForManualSearch(1, 7);
    expect(statusOf(episodeUpdate)).toBe("downloaded");
  });

  it("manual status wanted on a movie or episode with a file stays downloaded", async () => {
    files = onDisk;
    await updateLibraryStatus(1, "wanted");
    await setEpisodeStatus(1, 7, "wanted");
    expect(statusOf(mediaUpdate)).toBe("downloaded");
    expect(statusOf(episodeUpdate)).toBe("downloaded");
  });

  it("manual status skipped is untouched by a file", async () => {
    files = onDisk;
    await updateLibraryStatus(1, "skipped");
    expect(statusOf(mediaUpdate)).toBe("skipped");
  });

  it("reverting a failed grab restores downloaded when a file exists", async () => {
    files = onDisk;
    await revertToWantedIfNoActiveGrabs({ id: 9, mediaId: 1, episodeId: null });
    expect(statusOf(mediaUpdateMany)).toBe("downloaded");
    await revertToWantedIfNoActiveGrabs({ id: 9, mediaId: 1, episodeId: 7 });
    expect(statusOf(episodeUpdateMany)).toBe("downloaded");
  });

  it("reverting a failed grab makes an empty target wanted", async () => {
    await revertToWantedIfNoActiveGrabs({ id: 9, mediaId: 1, episodeId: null });
    expect(statusOf(mediaUpdateMany)).toBe("wanted");
  });

  it("the sync heal flips wanted rows that have files", async () => {
    expect(await healWantedWithFiles()).toBe(3);
    const where = (mediaUpdateMany.mock.calls[0]![0] as { where: unknown })
      .where;
    expect(where).toMatchObject({
      status: "wanted",
      type: "movie",
      files: { some: {} },
    });
    expect(statusOf(episodeUpdateMany)).toBe("downloaded");
  });

  it("retrying skipped episodes sends ones with files to downloaded", async () => {
    expect(await retrySkippedEpisodes(1, 2)).toBe(2);
    const sent = episodeUpdateMany.mock.calls.map(
      (c) => c[0] as { where: { files: object }; data: { status: string } },
    );
    expect(sent).toHaveLength(2);
    expect(sent.find((c) => "none" in c.where.files)?.data.status).toBe(
      "wanted",
    );
    expect(sent.find((c) => "some" in c.where.files)?.data.status).toBe(
      "downloaded",
    );
  });
});
