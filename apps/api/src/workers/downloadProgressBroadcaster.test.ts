import { describe, expect, it } from "bun:test";
import type { NormalizedTorrent } from "@rawkoon/api/services/downloadClient/types";
import {
  type ActiveDownloadRow,
  buildProgressPayload,
  runDownloadProgressPass,
  selectActiveDownloadHashes,
  shouldBroadcast,
} from "@rawkoon/api/workers/downloadProgressBroadcaster";

function row(over: Partial<ActiveDownloadRow>): ActiveDownloadRow {
  return {
    id: 1,
    mediaId: 10,
    completedAt: null,
    failed: false,
    torrentHash: "ABC",
    ...over,
  };
}

function torrent(over: Partial<NormalizedTorrent>): NormalizedTorrent {
  return {
    hash: "abc",
    name: "release",
    state: "downloading",
    progress: 0.4,
    savePath: "/dl",
    contentPath: null,
    seeds: 1,
    peers: 1,
    dlSpeed: 1000,
    upSpeed: 0,
    seedingTimeSecs: null,
    category: null,
    sizeBytes: 100,
    labels: [],
    ratio: null,
    ...over,
  };
}

describe("selectActiveDownloadHashes", () => {
  it("keeps only in-flight rows, lowercased", () => {
    const rows = [
      row({ id: 1, torrentHash: "ABC" }),
      row({ id: 2, completedAt: new Date() }),
      row({ id: 3, failed: true }),
      row({ id: 4, torrentHash: null }),
    ];
    expect(selectActiveDownloadHashes(rows)).toEqual(["abc"]);
  });
});

describe("buildProgressPayload", () => {
  it("matches by hash case-insensitively and groups by media", () => {
    const rows = [
      row({ id: 1, mediaId: 10, torrentHash: "AAA" }),
      row({ id: 2, mediaId: 10, torrentHash: "BBB" }),
      row({ id: 3, mediaId: 20, torrentHash: "CCC" }),
    ];
    const torrents = [
      torrent({
        hash: "aaa",
        progress: 0.1,
        dlSpeed: 500,
        state: "downloading",
      }),
      torrent({ hash: "bbb", progress: 0.9, dlSpeed: 0, state: "stalled" }),
      torrent({
        hash: "ccc",
        progress: 0.5,
        dlSpeed: 200,
        state: "downloading",
      }),
    ];
    const grouped = buildProgressPayload(rows, torrents);
    expect(grouped.get(10)).toEqual([
      {
        id: 1,
        progress: 0.1,
        state: "downloading",
        downloadSpeed: 500,
        etaSeconds: null,
      },
      {
        id: 2,
        progress: 0.9,
        state: "stalled",
        downloadSpeed: 0,
        etaSeconds: null,
      },
    ]);
    expect(grouped.get(20)).toEqual([
      {
        id: 3,
        progress: 0.5,
        state: "downloading",
        downloadSpeed: 200,
        etaSeconds: null,
      },
    ]);
  });

  it("skips rows whose torrent the client doesn't report", () => {
    const rows = [row({ id: 1, mediaId: 10, torrentHash: "AAA" })];
    const grouped = buildProgressPayload(rows, []);
    expect(grouped.size).toBe(0);
  });

  it("skips completed/failed/hashless rows even if a torrent matches", () => {
    const rows = [
      row({ id: 1, mediaId: 10, torrentHash: "AAA", completedAt: new Date() }),
      row({ id: 2, mediaId: 10, torrentHash: "AAA", failed: true }),
    ];
    const grouped = buildProgressPayload(rows, [torrent({ hash: "aaa" })]);
    expect(grouped.size).toBe(0);
  });
});

describe("shouldBroadcast", () => {
  it("requires both a listener and an active row", () => {
    expect(shouldBroadcast(1, 1)).toBe(true);
    expect(shouldBroadcast(0, 1)).toBe(false);
    expect(shouldBroadcast(1, 0)).toBe(false);
    expect(shouldBroadcast(0, 0)).toBe(false);
  });
});

describe("runDownloadProgressPass", () => {
  it("does not poll the client when nobody is listening", async () => {
    let polled = false;
    const emitted: number[] = [];
    const result = await runDownloadProgressPass({
      listenerCount: () => 0,
      activeRows: async () => [row({})],
      listTorrents: async () => {
        polled = true;
        return [];
      },
      emit: (mediaId) => emitted.push(mediaId),
    });
    expect(result).toBe(false);
    expect(polled).toBe(false);
    expect(emitted).toEqual([]);
  });

  it("does not poll when there are no active rows", async () => {
    let polled = false;
    const result = await runDownloadProgressPass({
      listenerCount: () => 2,
      activeRows: async () => [],
      listTorrents: async () => {
        polled = true;
        return [];
      },
      emit: () => {},
    });
    expect(result).toBe(false);
    expect(polled).toBe(false);
  });

  it("emits one event per media when listening and active", async () => {
    const emitted: Array<{ mediaId: number; count: number }> = [];
    const result = await runDownloadProgressPass({
      listenerCount: () => 1,
      activeRows: async () => [
        row({ id: 1, mediaId: 10, torrentHash: "AAA" }),
        row({ id: 2, mediaId: 20, torrentHash: "BBB" }),
      ],
      listTorrents: async () => [
        torrent({ hash: "aaa" }),
        torrent({ hash: "bbb" }),
      ],
      emit: (mediaId, downloads) =>
        emitted.push({ mediaId, count: downloads.length }),
    });
    expect(result).toBe(true);
    expect(emitted).toEqual([
      { mediaId: 10, count: 1 },
      { mediaId: 20, count: 1 },
    ]);
  });

  it("swallows a client failure without emitting", async () => {
    let emittedAny = false;
    const result = await runDownloadProgressPass({
      listenerCount: () => 1,
      activeRows: async () => [row({})],
      listTorrents: async () => {
        throw new Error("client down");
      },
      emit: () => {
        emittedAny = true;
      },
    });
    expect(result).toBe(false);
    expect(emittedAny).toBe(false);
  });
});
