import { beforeEach, describe, expect, it, mock } from "bun:test";

const remove = mock(async (_hash: string, _deleteData: boolean) => {});
const getTorrent = mock(async (_hash: string): Promise<unknown> => null);
const updateMany = mock(async (_arg: unknown) => ({ count: 1 }));
const mediaUpdateMany = mock(async (_arg: unknown) => ({ count: 1 }));
const revert = mock(async (_dh: unknown) => {});
type Row = {
  id: number;
  mediaId: number;
  episodeId: null;
  torrentHash: string | null;
  releaseTitle: string;
};
let rows: Row[] = [];
let sharedCount = 0;
let claimCounts: number[] = [];
let unclaimThrows = false;

mock.module("@rawkoon/api/db", () => ({
  prisma: {
    downloadHistory: {
      findMany: async () => rows,
      count: async () => sharedCount,
      updateMany: async (arg: { data: { failed: boolean } }) => {
        if (arg.data.failed) return { count: claimCounts.shift() ?? 1 };
        updateMany(arg);
        if (unclaimThrows) throw new Error("ux_download_history_active_target");
        return { count: 1 };
      },
    },
    libraryMedia: { updateMany: mediaUpdateMany },
  },
}));
mock.module("@rawkoon/api/services/downloadClient/registry", () => ({
  resolveActiveAdapter: async () => ({ adapter: { remove, getTorrent } }),
}));
mock.module("@rawkoon/api/services/downloads/downloadOutcome", () => ({
  revertToWantedIfNoActiveGrabs: revert,
}));
mock.module("@rawkoon/api/services/libraryEvents", () => ({
  emitLibraryUpdate: () => {},
}));

const { cancelActiveMovieDownloads } = await import("./replaceActiveDownload");

const hash = "a".repeat(40);
const release = {
  releaseTitle: "New.Release.2160p",
  downloadUrl: `magnet:?xt=urn:btih:${"b".repeat(40)}`,
};

describe("cancelActiveMovieDownloads", () => {
  beforeEach(() => {
    remove.mockClear();
    updateMany.mockClear();
    revert.mockClear();
    getTorrent.mockClear();
    remove.mockImplementation(async () => {});
    getTorrent.mockImplementation(async () => null);
    sharedCount = 0;
    claimCounts = [];
    unclaimThrows = false;
    rows = [
      {
        id: 7,
        mediaId: 1,
        episodeId: null,
        torrentHash: hash,
        releaseTitle: "Old.Release.1080p",
      },
    ];
  });

  it("claims the row, removes the torrent with its data and reverts the item", async () => {
    expect(await cancelActiveMovieDownloads(1, release)).toEqual({
      status: "cancelled",
      cancelled: 1,
    });
    expect(remove).toHaveBeenCalledWith(hash, true);
    expect(revert).toHaveBeenCalledTimes(1);
  });

  it("keeps the data when another download shares the torrent", async () => {
    sharedCount = 1;
    await cancelActiveMovieDownloads(1, release);
    expect(remove).toHaveBeenCalledWith(hash, false);
  });

  it("does not touch the torrent when the row completed meanwhile", async () => {
    claimCounts = [0];
    const result = await cancelActiveMovieDownloads(1, release);
    expect(result.status).toBe("refused");
    expect(remove).not.toHaveBeenCalled();
  });

  it("claims every row before removing any torrent", async () => {
    rows = [
      { ...rows[0], id: 7 },
      { ...rows[0], id: 8, torrentHash: "c".repeat(40), releaseTitle: "Other" },
    ];
    claimCounts = [1, 0];
    const result = await cancelActiveMovieDownloads(1, release);
    expect(result).toMatchObject({ status: "refused", stopped: 0 });
    expect(remove).not.toHaveBeenCalled();
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: { in: [7] } },
      data: { failed: false, failReason: null },
    });
  });

  it("reports torrents already removed when a later one cannot be stopped", async () => {
    rows = [
      { ...rows[0], id: 7 },
      { ...rows[0], id: 8, torrentHash: "c".repeat(40), releaseTitle: "Other" },
    ];
    remove.mockImplementation(async (h: string) => {
      if (h === "c".repeat(40)) throw new Error("client down");
    });
    getTorrent.mockImplementation(async () => ({ hash: "c" }));
    const result = await cancelActiveMovieDownloads(1, release);
    expect(result).toMatchObject({ status: "refused", stopped: 1 });
    expect(revert).toHaveBeenCalledTimes(1);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: { in: [8] } },
      data: { failed: false, failReason: null },
    });
  });

  it("refuses clearly, without throwing, when the claim cannot be restored", async () => {
    remove.mockImplementation(async () => {
      throw new Error("client down");
    });
    getTorrent.mockImplementation(async () => ({ hash }));
    unclaimThrows = true;
    const result = await cancelActiveMovieDownloads(1, release);
    expect(result.status).toBe("refused");
    if (result.status === "refused") {
      expect(result.reason).toContain("could not be restored");
    }
  });

  it("compares hashes only when both sides have one", async () => {
    const sameHash = {
      releaseTitle: "Completely.Different.Title",
      downloadUrl: `magnet:?xt=urn:btih:${hash}`,
    };
    expect(await cancelActiveMovieDownloads(1, sameHash)).toEqual({
      status: "already_active",
    });
    const sameTitleOtherHash = {
      releaseTitle: "Old.Release.1080p",
      downloadUrl: `magnet:?xt=urn:btih:${"b".repeat(40)}`,
    };
    expect(
      (await cancelActiveMovieDownloads(1, sameTitleOtherHash)).status,
    ).toBe("cancelled");
  });

  it("undoes the claim and refuses on a client error", async () => {
    remove.mockImplementation(async () => {
      throw new Error("client down");
    });
    getTorrent.mockImplementation(async () => ({ hash }));
    const result = await cancelActiveMovieDownloads(1, release);
    expect(result.status).toBe("refused");
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: { in: [7] } },
      data: { failed: false, failReason: null },
    });
    expect(revert).not.toHaveBeenCalled();
  });

  it("treats a torrent the client no longer has as removed", async () => {
    remove.mockImplementation(async () => {
      throw new Error("not found");
    });
    const result = await cancelActiveMovieDownloads(1, release);
    expect(result).toEqual({ status: "cancelled", cancelled: 1 });
  });

  it("matches by title when neither side has a hash", async () => {
    rows = [{ ...rows[0], torrentHash: null }];
    const result = await cancelActiveMovieDownloads(1, {
      releaseTitle: " old.release.1080p ",
      downloadUrl: "https://idx.example/x.torrent",
    });
    expect(result).toEqual({ status: "already_active" });
    expect(remove).not.toHaveBeenCalled();
  });

  it("still clears a stale downloading status when no row is active", async () => {
    rows = [];
    expect(await cancelActiveMovieDownloads(1, release)).toEqual({
      status: "cancelled",
      cancelled: 0,
    });
    expect(mediaUpdateMany).toHaveBeenCalled();
  });
});
