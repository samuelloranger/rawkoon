import { beforeEach, describe, expect, it, mock } from "bun:test";

type MediaRow = {
  id: number;
  type: string;
  tmdbId: number;
  status: string;
  downloadedEpisodeCount: number | null;
};

let mediaRow: MediaRow;
let pendingShowLevelGrabs = 0;

const findUnique = mock(async () => mediaRow);
const update = mock(async (_args: unknown): Promise<unknown> => ({}));
const executeRaw = mock(async () => 1);
const dhCount = mock(async (_args: unknown) => pendingShowLevelGrabs);

mock.module("@rawkoon/api/db", () => ({
  prisma: {
    libraryMedia: { findUnique, update },
    downloadHistory: { count: dhCount },
    $executeRaw: executeRaw,
  },
}));

const realHelpers = await import("@rawkoon/api/utils/medias/libraryHelpers");

mock.module("@rawkoon/api/utils/medias/libraryHelpers", () => ({
  ...realHelpers,
  getLibraryTmdbApiKey: mock(async () => "tmdb-key"),
  tmdbApiFetch: mock(async () => ({ status: "Returning Series" })),
  upsertLibraryShowEpisodesFromTmdb: mock(async () => {}),
}));

const { syncLibraryShowEpisodes } = await import(
  "@rawkoon/api/services/libraryTmdbRefresh"
);

function statusWritten(): string | undefined {
  const args = update.mock.calls.at(-1)?.[0] as
    | { data: { status?: string } }
    | undefined;
  return args?.data.status;
}

describe("syncLibraryShowEpisodes status reconciliation", () => {
  beforeEach(() => {
    update.mockClear();
    dhCount.mockClear();
    pendingShowLevelGrabs = 0;
    mediaRow = {
      id: 675,
      type: "show",
      tmdbId: 202555,
      status: "returning",
      downloadedEpisodeCount: 17,
    };
  });

  it("recomputes the status of a show already in a production status", async () => {
    await syncLibraryShowEpisodes(675);
    expect(statusWritten()).toBe("returning");
  });

  it("heals a show latched on 'downloading' with no show-level grab in flight", async () => {
    mediaRow.status = "downloading";
    await syncLibraryShowEpisodes(675);
    expect(statusWritten()).toBe("returning");
  });

  it("heals a latched show with no downloaded episodes back to 'wanted'", async () => {
    mediaRow.status = "downloading";
    mediaRow.downloadedEpisodeCount = 0;
    await syncLibraryShowEpisodes(675);
    expect(statusWritten()).toBe("wanted");
  });

  it("leaves 'downloading' alone while a show-level grab is still pending", async () => {
    mediaRow.status = "downloading";
    pendingShowLevelGrabs = 1;
    await syncLibraryShowEpisodes(675);
    expect(statusWritten()).toBeUndefined();
  });

  it("leaves 'upgrading' alone while a show-level grab is still pending", async () => {
    mediaRow.status = "upgrading";
    pendingShowLevelGrabs = 1;
    await syncLibraryShowEpisodes(675);
    expect(statusWritten()).toBeUndefined();
  });

  it("does not count episode-level grabs as a show-level grab", async () => {
    mediaRow.status = "downloading";
    await syncLibraryShowEpisodes(675);
    const arg = dhCount.mock.calls.at(-1)?.[0] as {
      where: {
        episodeId: number | null;
        failed: boolean;
        completedAt: Date | null;
      };
    };
    expect(arg.where.episodeId).toBeNull();
    expect(arg.where.failed).toBe(false);
    expect(arg.where.completedAt).toBeNull();
  });
});
