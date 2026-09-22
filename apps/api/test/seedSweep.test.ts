import { beforeEach, describe, expect, it, mock } from "bun:test";
import type {
  DownloadClientAdapter,
  NormalizedTorrent,
} from "@rawkoon/api/services/downloadClient/types";
import {
  abandonPendingDownloads,
  planSeedReleases,
  releaseTorrentNow,
  runSeedSweep,
  type SweepContext,
  type SweepDeps,
} from "@rawkoon/api/services/seeding/seedSweep";

const H1 = "11".repeat(20);
const H2 = "22".repeat(20);
const GB = 1024 ** 3;

function t(o: Partial<NormalizedTorrent> = {}): NormalizedTorrent {
  return {
    hash: H1,
    name: "T",
    state: "completed",
    progress: 1,
    savePath: "/dl",
    contentPath: `/dl/${o.hash ?? H1}`,
    seeds: 0,
    peers: 0,
    dlSpeed: 0,
    upSpeed: 0,
    seedingTimeSecs: 0,
    category: "rawkoon-movies",
    sizeBytes: GB,
    labels: [],
    ratio: 0,
    ...o,
  };
}

const baseCtx: SweepContext = {
  defaults: {
    publicRule: { ratio: 1, seedTimeMins: null },
    privateRule: { ratio: 1, seedTimeMins: 4320 },
  },
  overrides: new Map(),
  privacy: new Map([
    ["harbor", false],
    ["nimbus", true],
  ]),
  moveMode: false,
  pendingHashes: new Set(),
};

describe("planSeedReleases", () => {
  it("stamps rows whose torrent left the client", () => {
    expect(
      planSeedReleases(
        [{ id: 1, torrentHash: H1, indexer: "Harbor" }],
        [],
        baseCtx,
      ),
    ).toEqual([{ hash: H1, action: "stamp", reason: "manual", rowIds: [1] }]);
  });
  it("matches an uppercase DB hash to a lowercase client hash", () => {
    const [d] = planSeedReleases(
      [{ id: 1, torrentHash: H1.toUpperCase(), indexer: "Harbor" }],
      [t({ ratio: 1.2 })],
      baseCtx,
    );
    expect(d).toMatchObject({
      action: "release",
      reason: "target_met",
      rowIds: [1],
    });
  });
  it("skips while a sibling row on the hash is still downloading", () => {
    const [d] = planSeedReleases(
      [{ id: 1, torrentHash: H1, indexer: "Harbor" }],
      [t({ ratio: 5 })],
      { ...baseCtx, pendingHashes: new Set([H1]) },
    );
    expect(d).toMatchObject({ action: "skip", why: "pending" });
  });
  it("marks torrents Rawkoon did not add as adopted", () => {
    const [d] = planSeedReleases(
      [{ id: 1, torrentHash: H1, indexer: "Harbor" }],
      [t({ category: "radarr", ratio: 5 })],
      baseCtx,
    );
    expect(d).toMatchObject({ action: "stamp", reason: "adopted" });
  });
  it("releases immediately in move mode", () => {
    const [d] = planSeedReleases(
      [{ id: 1, torrentHash: H1, indexer: "Nimbus" }],
      [t()],
      { ...baseCtx, moveMode: true },
    );
    expect(d).toMatchObject({ action: "release", reason: "move_mode" });
  });
  it("holds a private torrent until its seed time", () => {
    const [d] = planSeedReleases(
      [{ id: 1, torrentHash: H1, indexer: "Nimbus" }],
      [t({ ratio: 0.2, seedingTimeSecs: 3600 })],
      baseCtx,
    );
    expect(d).toMatchObject({ action: "skip", why: "not_met" });
  });
  it("requires every owning row's rule to be met", () => {
    const rows = [
      { id: 1, torrentHash: H1, indexer: "Harbor" },
      { id: 2, torrentHash: H1, indexer: "Nimbus" },
    ];
    const [d] = planSeedReleases(
      rows,
      [t({ ratio: 0.5, seedingTimeSecs: 60 })],
      baseCtx,
    );
    expect(d).toMatchObject({ action: "skip", why: "not_met", rowIds: [1, 2] });
  });
  it("keeps the data of a cross-seeded torrent", () => {
    const shared = [
      t({ ratio: 2, contentPath: "/dl/Film" }),
      t({ hash: H2, contentPath: "/dl/Film" }),
    ];
    const [d] = planSeedReleases(
      [{ id: 1, torrentHash: H1, indexer: "Harbor" }],
      shared,
      baseCtx,
    );
    expect(d).toMatchObject({ action: "release", deleteData: false });
  });
});

describe("runSeedSweep", () => {
  let torrents: NormalizedTorrent[];
  let removed: string[];
  let deps: SweepDeps;
  let adapter: DownloadClientAdapter;

  beforeEach(() => {
    torrents = [t({ ratio: 2 })];
    removed = [];
    adapter = {
      type: "qbittorrent",
      testConnection: async () => ({ ok: true }),
      addTorrent: async () => ({ hash: null }),
      listTorrents: async () => torrents,
      getTorrent: async () => null,
      listFiles: async () => null,
      pause: async () => {},
      resume: async () => {},
      remove: async (h) => {
        removed.push(h);
      },
    };
    deps = {
      isEnabled: async () => true,
      loadContext: async () => ({
        defaults: baseCtx.defaults,
        overrides: baseCtx.overrides,
        privacy: baseCtx.privacy,
        moveMode: false,
      }),
      loadRows: async () => [{ id: 1, torrentHash: H1, indexer: "Harbor" }],
      loadPendingHashes: async () => new Set(),
      resolveAdapter: async () => adapter,
      stamp: mock(async () => {}),
      emit: mock(() => {}),
    };
  });

  it("does nothing while disabled", async () => {
    deps.isEnabled = async () => false;
    expect(await runSeedSweep(deps)).toEqual([]);
    expect(removed).toEqual([]);
  });
  it("releases, stamps with the size, and emits the release", async () => {
    await runSeedSweep(deps);
    expect(removed).toEqual([H1]);
    expect(deps.stamp).toHaveBeenCalledWith([1], "target_met", BigInt(GB));
    expect(deps.emit).toHaveBeenCalledTimes(1);
  });
  it("stamps nothing when the client is unreachable", async () => {
    adapter.listTorrents = async () => {
      throw new Error("down");
    };
    expect(await runSeedSweep(deps)).toEqual([]);
    expect(deps.stamp).not.toHaveBeenCalled();
  });
  it("leaves rows unstamped when remove throws, so the next pass retries", async () => {
    adapter.remove = async () => {
      throw new Error("busy");
    };
    await runSeedSweep(deps);
    expect(deps.stamp).not.toHaveBeenCalled();
  });
});

describe("releaseTorrentNow", () => {
  const adapterWith = (
    list: NormalizedTorrent[],
    removed: string[],
  ): DownloadClientAdapter => ({
    type: "qbittorrent",
    testConnection: async () => ({ ok: true }),
    addTorrent: async () => ({ hash: null }),
    listTorrents: async () => list,
    getTorrent: async () => null,
    listFiles: async () => null,
    pause: async () => {},
    resume: async () => {},
    remove: async (h) => {
      removed.push(h);
    },
  });
  const deps = (o: Partial<SweepDeps>): SweepDeps => ({
    isEnabled: async () => false, // manual release ignores the switch
    loadContext: async () => ({ ...baseCtx }),
    loadRows: async () => [{ id: 9, torrentHash: H1, indexer: "Nimbus" }],
    loadPendingHashes: async () => new Set(),
    resolveAdapter: async () => null,
    stamp: mock(async () => {}),
    emit: () => {},
    ...o,
  });

  it("removes regardless of target and stamps manual", async () => {
    const removed: string[] = [];
    const d = deps({
      resolveAdapter: async () => adapterWith([t({ ratio: 0 })], removed),
    });
    expect(await releaseTorrentNow(H1.toUpperCase(), d)).toEqual({
      status: "released",
      freedBytes: GB,
    });
    expect(removed).toEqual([H1]);
    expect(d.stamp).toHaveBeenCalledWith([9], "manual", BigInt(GB));
  });
  it("refuses while still downloading", async () => {
    expect(
      await releaseTorrentNow(
        H1,
        deps({ loadPendingHashes: async () => new Set([H1]) }),
      ),
    ).toEqual({ status: "pending" });
  });
  it("reports an unreachable client as unavailable instead of throwing", async () => {
    const down = adapterWith([], []);
    down.listTorrents = async () => {
      throw new Error("client down");
    };
    expect(
      await releaseTorrentNow(H1, deps({ resolveAdapter: async () => down })),
    ).toEqual({
      status: "unavailable",
    });
  });

  it("reports unknown hashes", async () => {
    expect(
      await releaseTorrentNow(H1, deps({ loadRows: async () => [] })),
    ).toEqual({ status: "not_found" });
  });
});

describe("abandonPendingDownloads", () => {
  it("fails pending rows and removes their owned torrents with data", async () => {
    const removed: Array<[string, boolean]> = [];
    const marked: number[][] = [];
    await abandonPendingDownloads(
      [
        { id: 5, torrentHash: H1.toUpperCase() },
        { id: 6, torrentHash: null },
      ],
      {
        resolveAdapter: async () => ({
          type: "qbittorrent",
          testConnection: async () => ({ ok: true }),
          addTorrent: async () => ({ hash: null }),
          listTorrents: async () => [
            t({ progress: 0.3, state: "downloading" }),
          ],
          getTorrent: async () => null,
          listFiles: async () => null,
          pause: async () => {},
          resume: async () => {},
          remove: async (h, d) => {
            removed.push([h, d]);
          },
        }),
        markAbandoned: async (ids) => {
          marked.push(ids);
        },
      },
    );
    expect(marked).toEqual([[5, 6]]);
    expect(removed).toEqual([[H1, true]]);
  });
});
