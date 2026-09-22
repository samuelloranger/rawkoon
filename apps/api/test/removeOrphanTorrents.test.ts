import { describe, expect, it } from "bun:test";
import type {
  DownloadClientAdapter,
  NormalizedTorrent,
} from "@rawkoon/api/services/downloadClient/types";
import { removeOrphanTorrents } from "@rawkoon/api/services/seeding/orphans";

const A = "aa".repeat(20);
const B = "bb".repeat(20);
const C = "cc".repeat(20);
const D = "dd".repeat(20);
const t = (o: Partial<NormalizedTorrent>): NormalizedTorrent => ({
  hash: A,
  name: "n",
  state: "completed",
  progress: 1,
  savePath: "/dl",
  contentPath: `/dl/${o.hash ?? A}`,
  seeds: 0,
  peers: 0,
  dlSpeed: 0,
  upSpeed: 0,
  seedingTimeSecs: 0,
  category: "rawkoon-movies",
  sizeBytes: 100,
  labels: [],
  ratio: 1,
  ...o,
});

function adapter(
  list: NormalizedTorrent[],
  removed: Array<[string, boolean]>,
  failOn?: string,
): DownloadClientAdapter {
  return {
    type: "qbittorrent",
    testConnection: async () => ({ ok: true }),
    addTorrent: async () => ({ hash: null }),
    listTorrents: async () => list,
    getTorrent: async () => null,
    listFiles: async () => null,
    pause: async () => {},
    resume: async () => {},
    remove: async (h, d) => {
      if (h === failOn) throw new Error("busy");
      removed.push([h, d]);
    },
  };
}

describe("removeOrphanTorrents", () => {
  it("refuses owned and foreign torrents — only confirmed orphans are removed", async () => {
    const removed: Array<[string, boolean]> = [];
    const list = [
      t({ hash: A }),
      t({ hash: B }),
      t({ hash: C, category: "radarr" }),
    ];
    const res = await removeOrphanTorrents([A, B.toUpperCase(), C], true, {
      resolveAdapter: async () => adapter(list, removed),
      ownedHashes: async () => new Set([A]),
    });
    expect(removed).toEqual([[B, true]]);
    expect(res).toEqual({ removed: [B], refused: [A, C], freed_bytes: 100 });
  });

  it("keeps the files of an orphan that shares them with another torrent", async () => {
    const removed: Array<[string, boolean]> = [];
    const list = [
      t({ hash: B, contentPath: "/dl/X" }),
      t({ hash: D, category: "radarr", contentPath: "/dl/X" }),
    ];
    const res = await removeOrphanTorrents([B], true, {
      resolveAdapter: async () => adapter(list, removed),
      ownedHashes: async () => new Set(),
    });
    expect(removed).toEqual([[B, false]]);
    expect(res && "freed_bytes" in res ? res.freed_bytes : -1).toBe(0);
  });

  it("keeps going after one removal fails and reports it as refused", async () => {
    const removed: Array<[string, boolean]> = [];
    const list = [t({ hash: B }), t({ hash: D })];
    const res = await removeOrphanTorrents([B, D], false, {
      resolveAdapter: async () => adapter(list, removed, B),
      ownedHashes: async () => new Set(),
    });
    expect(removed).toEqual([[D, false]]);
    expect(res).toMatchObject({ removed: [D], refused: [B] });
  });

  it("reports an unreachable client instead of throwing", async () => {
    const down = adapter([], []);
    down.listTorrents = async () => {
      throw new Error("down");
    };
    expect(
      await removeOrphanTorrents([B], true, {
        resolveAdapter: async () => down,
        ownedHashes: async () => new Set(),
      }),
    ).toBeNull();
  });
});
