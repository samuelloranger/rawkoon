import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { NormalizedTorrent } from "@rawkoon/api/services/downloadClient/types";

const findMedia = mock(async () => ({ id: 5 }));
const findHistory = mock(
  async () =>
    [] as Array<{
      torrentHash: string | null;
      completedAt: Date | null;
      failed: boolean;
      seedReleasedAt: Date | null;
    }>,
);
const listTorrents = mock(async () => [] as NormalizedTorrent[]);
mock.module("@rawkoon/api/db", () => ({
  prisma: {
    libraryMedia: { findUnique: findMedia },
    downloadHistory: { findMany: findHistory },
  },
}));
mock.module("@rawkoon/api/services/downloadClient/registry", () => ({
  resolveActiveAdapter: async () => ({ adapter: { listTorrents } }),
}));

const { getDownloadHistoryWithLive, parsedQualityFromStored, sizeBytesForRow } =
  await import("./libraryFiles");

function torrent(over: Partial<NormalizedTorrent>): NormalizedTorrent {
  return {
    hash: "abc",
    name: "release",
    state: "downloading",
    progress: 0.5,
    savePath: "/dl",
    contentPath: null,
    seeds: 1,
    peers: 1,
    dlSpeed: 0,
    upSpeed: 0,
    seedingTimeSecs: null,
    category: null,
    sizeBytes: 2_000_000_000,
    labels: [],
    ratio: null,
    ...over,
  };
}

describe("sizeBytesForRow", () => {
  it("prefers the size of the torrent the client still holds", () => {
    expect(sizeBytesForRow({ seedReleasedBytes: null }, torrent({}))).toBe(
      2_000_000_000,
    );
  });

  it("falls back to the size stamped at release once the torrent is gone", () => {
    expect(
      sizeBytesForRow({ seedReleasedBytes: 1_500_000_000n }, undefined),
    ).toBe(1_500_000_000);
  });

  it("returns null when no size was ever known", () => {
    expect(sizeBytesForRow({ seedReleasedBytes: null }, undefined)).toBeNull();
  });

  it("ignores a zero torrent size and falls back to the stamped one", () => {
    expect(
      sizeBytesForRow(
        { seedReleasedBytes: 900_000_000n },
        torrent({ sizeBytes: 0 }),
      ),
    ).toBe(900_000_000);
  });
});

describe("parsedQualityFromStored", () => {
  it("passes the stored fields through", () => {
    expect(
      parsedQualityFromStored({
        resolution: 1080,
        source: "BluRay",
        codec: "x265",
        hdr: "DV",
      }),
    ).toEqual({ resolution: 1080, source: "BluRay", codec: "x265", hdr: "DV" });
  });

  it("normalizes a string resolution like 1080p to its number", () => {
    expect(
      parsedQualityFromStored({
        resolution: "1080p",
        source: null,
        codec: null,
        hdr: null,
      }),
    ).toEqual({ resolution: 1080, source: null, codec: null, hdr: null });
  });

  it("keeps whichever fields are usable and nulls the rest", () => {
    expect(parsedQualityFromStored({ codec: "x264" })).toEqual({
      resolution: null,
      source: null,
      codec: "x264",
      hdr: null,
    });
  });

  it("returns null when nothing in the JSON is usable", () => {
    expect(
      parsedQualityFromStored({
        resolution: "garbage",
        source: 42,
        codec: true,
      }),
    ).toBeNull();
  });

  it("returns null for absent or non-object stored values", () => {
    expect(parsedQualityFromStored(null)).toBeNull();
    expect(parsedQualityFromStored(undefined)).toBeNull();
    expect(parsedQualityFromStored("1080p")).toBeNull();
    expect(parsedQualityFromStored(["1080p"])).toBeNull();
  });
});

describe("getDownloadHistoryWithLive", () => {
  beforeEach(() => {
    findHistory.mockReset();
    listTorrents.mockReset();
  });

  it("provides size for active and seeding torrents, and progress only for active rows", async () => {
    const active = {
      torrentHash: "ABC",
      completedAt: null,
      failed: false,
      seedReleasedAt: null,
    };
    findHistory.mockResolvedValue([
      active,
      { ...active, torrentHash: "DEF", completedAt: new Date() },
      { ...active, torrentHash: "GHI", failed: true },
      {
        ...active,
        torrentHash: "JKL",
        completedAt: new Date(),
        seedReleasedAt: new Date(),
      },
    ]);
    listTorrents.mockResolvedValue(
      ["abc", "def", "ghi", "jkl", "other"].map((hash) => torrent({ hash })),
    );
    const result = await getDownloadHistoryWithLive(5);
    expect([...result!.torrentByHash.keys()]).toEqual(["abc", "def", "ghi"]);
    expect([...result!.liveByHash.keys()]).toEqual(["abc"]);
    expect(result!.liveByHash.get("abc")).toMatchObject({ seeds: 1, peers: 1 });
    expect(
      sizeBytesForRow(
        { seedReleasedBytes: null },
        result!.torrentByHash.get("abc"),
      ),
    ).toBe(2_000_000_000);
  });

  it("keeps history available when the download client is offline", async () => {
    findHistory.mockResolvedValue([
      {
        torrentHash: "ABC",
        completedAt: null,
        failed: false,
        seedReleasedAt: null,
      },
    ]);
    listTorrents.mockRejectedValue(new Error("offline"));
    const result = await getDownloadHistoryWithLive(5);
    expect(result!.items).toHaveLength(1);
    expect(result!.torrentByHash.size).toBe(0);
    expect(result!.liveByHash.size).toBe(0);
  });

  it("does not poll for released torrents", async () => {
    findHistory.mockResolvedValue([
      {
        torrentHash: "ABC",
        completedAt: new Date(),
        failed: false,
        seedReleasedAt: new Date(),
      },
    ]);
    await getDownloadHistoryWithLive(5);
    expect(listTorrents).not.toHaveBeenCalled();
  });
});
