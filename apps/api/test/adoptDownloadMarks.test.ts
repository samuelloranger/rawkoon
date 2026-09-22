import { describe, expect, it, mock } from "bun:test";

// An adopted torrent was added by the user, not Rawkoon; the seeding lifecycle must never remove it.
const updates: Array<Record<string, unknown>> = [];

mock.module("@rawkoon/api/services/queueService", () => ({
  QUEUE_NAMES: { LIBRARY_POST_PROCESS: "library-post-process" },
  POST_PROCESS_JOB_NAME: "post-process",
  addJob: () => Promise.resolve({}),
}));

mock.module("@rawkoon/api/db", () => ({
  prisma: {
    downloadHistory: {
      update: (args: { data: Record<string, unknown> }) => {
        updates.push(args.data);
        return Promise.resolve({ id: 1 });
      },
    },
    libraryMedia: { update: () => Promise.resolve({}) },
    libraryEpisode: { update: () => Promise.resolve({}) },
    bookEdition: { update: () => Promise.resolve({ bookId: 1 }) },
  },
}));

const { adoptDownload } = await import("@rawkoon/api/services/downloadOutcome");

describe("adoptDownload", () => {
  it("marks the row adopted so its torrent is never released by Rawkoon", async () => {
    await adoptDownload({
      dh: { id: 1, mediaId: 5, episodeId: null },
      torrentHash: "ab".repeat(20),
      completed: false,
    });
    expect(updates[0]).toMatchObject({ seedReleaseReason: "adopted" });
    expect(updates[0]?.seedReleasedAt).toBeInstanceOf(Date);
  });
});
