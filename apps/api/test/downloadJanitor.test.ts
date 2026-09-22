import { beforeEach, describe, expect, it, mock } from "bun:test";
import type {
  DownloadClientAdapter,
  NormalizedTorrent,
} from "@rawkoon/api/services/downloadClient/types";
import {
  rejectRelease,
  type JanitorDeps,
} from "@rawkoon/api/services/downloadJanitor";

const HASH = "ab".repeat(20);
function t(o: Partial<NormalizedTorrent> = {}): NormalizedTorrent {
  return {
    hash: HASH,
    name: "R",
    state: "stalled",
    progress: 0.1,
    savePath: "/dl",
    contentPath: "/dl/R",
    seeds: 0,
    peers: 0,
    dlSpeed: 0,
    upSpeed: 0,
    seedingTimeSecs: null,
    category: "rawkoon-movies",
    sizeBytes: 1000,
    labels: [],
    ratio: 0,
    ...o,
  };
}

let torrents: NormalizedTorrent[];
let removed: Array<[string, boolean]>;
let deps: JanitorDeps & { calls: string[] };

function adapter(): DownloadClientAdapter {
  return {
    type: "qbittorrent",
    testConnection: async () => ({ ok: true }),
    addTorrent: async () => ({ hash: null }),
    listTorrents: async () => torrents,
    getTorrent: async () => null,
    listFiles: async () => null,
    pause: async () => {},
    resume: async () => {},
    remove: async (h, d) => {
      removed.push([h, d]);
    },
  };
}

const dh = {
  id: 7,
  mediaId: 3,
  episodeId: null,
  torrentHash: HASH.toUpperCase(),
  releaseTitle: "R",
  indexer: "Nimbus",
};

beforeEach(() => {
  torrents = [t()];
  removed = [];
  const calls: string[] = [];
  deps = {
    calls,
    failDownload: mock(async () => {
      calls.push("fail");
    }),
    createBlocklist: mock(async () => {
      calls.push("blocklist");
    }),
    hashInUseByOthers: mock(async () => false),
    stampReleased: mock(async () => {
      calls.push("stamp");
    }),
    markRejected: mock(async () => {
      calls.push("mark");
    }),
    notifyBookRejected: mock(async () => {
      calls.push("notify-book");
    }),
    resolveAdapter: async () => adapter(),
  };
});

describe("rejectRelease", () => {
  it("fails, blocklists with its kind, removes with data, and stamps", async () => {
    await rejectRelease(dh, "stalled", "stalled - no progress", deps);
    expect(deps.calls).toEqual(["fail", "blocklist", "mark", "stamp"]);
    expect(deps.createBlocklist).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "stalled",
        torrentHash: HASH,
        mediaId: 3,
      }),
    );
    expect(removed).toEqual([[HASH, true]]);
    expect(deps.stampReleased).toHaveBeenCalledWith(7, "stalled", 1000n);
  });

  it("keeps data when another torrent shares the content path", async () => {
    torrents = [t(), t({ hash: "cd".repeat(20) })];
    await rejectRelease(dh, "malware", "blocked file", deps);
    expect(removed).toEqual([[HASH, false]]);
  });

  it("does not remove a torrent another live row still uses", async () => {
    deps.hashInUseByOthers = mock(async () => true);
    await rejectRelease(dh, "import_rejected", "no video", deps);
    expect(removed).toEqual([]);
    expect(deps.stampReleased).not.toHaveBeenCalled();
    expect(deps.calls).toEqual(["fail", "blocklist", "mark"]);
  });

  it("leaves a torrent Rawkoon did not add, keeping the rejection on the row", async () => {
    torrents = [t({ category: "radarr", labels: [] })];
    await rejectRelease(dh, "stalled", "x", deps);
    expect(removed).toEqual([]);
    expect(deps.markRejected).toHaveBeenCalledWith(7, "stalled");
    expect(deps.stampReleased).not.toHaveBeenCalled();
  });

  it("stamps without bytes when the torrent is already gone", async () => {
    torrents = [];
    await rejectRelease(dh, "stalled", "x", deps);
    expect(deps.stampReleased).toHaveBeenCalledWith(7, "stalled", null);
  });

  it("leaves the row unstamped when remove throws", async () => {
    const a = adapter();
    a.remove = async () => {
      throw new Error("client down");
    };
    deps.resolveAdapter = async () => a;
    await rejectRelease(dh, "stalled", "x", deps);
    expect(deps.stampReleased).not.toHaveBeenCalled();
  });

  it("records the rejection on the row even when the client is unreachable", async () => {
    deps.resolveAdapter = async () => null;
    await rejectRelease(dh, "malware", "blocked file", deps);
    expect(deps.markRejected).toHaveBeenCalledWith(7, "malware");
  });

  it("records the rejection when removing the torrent failed", async () => {
    const a = adapter();
    a.remove = async () => {
      throw new Error("client down");
    };
    deps.resolveAdapter = async () => a;
    await rejectRelease(dh, "stalled", "x", deps);
    expect(deps.markRejected).toHaveBeenCalledWith(7, "stalled");
  });

  it("tells admins when a book release is rejected", async () => {
    await rejectRelease(
      { ...dh, mediaId: null, bookEditionId: 11 },
      "malware",
      "blocked file type: a.exe",
      deps,
    );
    expect(deps.notifyBookRejected).toHaveBeenCalledWith(
      11,
      "blocked file type: a.exe",
    );
  });
});
