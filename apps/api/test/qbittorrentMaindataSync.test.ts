import { beforeEach, describe, expect, it } from "bun:test";
// createQbittorrentAdapter directly, NOT buildAdapter: four other test files
// module-mock the registry with `buildAdapter: (type) => ({ type })`, and
// mock.module is process-global — through the registry this adapter would arrive
// with no methods at all.
import { createQbittorrentAdapter } from "@rawkoon/api/services/downloadClient/qbittorrentAdapter";
import { fetchMaindata } from "@rawkoon/api/services/qbittorrent/clientFetch";
import {
  getMaindataState,
  resetMaindataState,
  setLastMaindataSnapshot,
} from "@rawkoon/api/services/qbittorrent/clientSession";

const config = {
  website_url: "http://localhost:8080",
  username: "u",
  password: "p",
  label: "rawkoon",
};

// Injected rather than module-mocked: Bun's mock.module is process-global and
// would leak into every other test file in the run.
function recordingFetcher(responses: unknown[]) {
  const paths: string[] = [];
  let i = 0;
  return {
    paths,
    fetchJson: <T>(_c: unknown, path: string): Promise<T> => {
      paths.push(path);
      return Promise.resolve(responses[i++] as T);
    },
  };
}

describe("fetchMaindata cursor", () => {
  beforeEach(() => {
    resetMaindataState();
    setLastMaindataSnapshot(null);
  });

  it("sends rid=0 first, then the revision returned by the client", async () => {
    const f = recordingFetcher([
      {
        rid: 5,
        full_update: true,
        server_state: { dl_info_speed: 100 },
        torrents: { aaa: { progress: 0.5 } },
      },
      { rid: 9, torrents: { aaa: { progress: 0.9 } } },
    ]);

    await fetchMaindata(config, { fetchJson: f.fetchJson });
    setLastMaindataSnapshot(null);
    await fetchMaindata(config, { fetchJson: f.fetchJson });

    expect(f.paths).toEqual([
      "/api/v2/sync/maindata?rid=0",
      "/api/v2/sync/maindata?rid=5",
    ]);
  });

  it("merges deltas into the retained projection", async () => {
    const f = recordingFetcher([
      {
        rid: 1,
        full_update: true,
        torrents: { aaa: { progress: 0.5, name: "A" } },
      },
      { rid: 2, torrents: { aaa: { progress: 1 } } },
    ]);

    await fetchMaindata(config, { fetchJson: f.fetchJson });
    setLastMaindataSnapshot(null);
    const second = await fetchMaindata(config, { fetchJson: f.fetchJson });

    expect(second.torrents.get("aaa")).toMatchObject({
      progress: 1,
      name: "A",
      hash: "aaa",
    });
  });

  it("drops torrents the client reports as removed", async () => {
    const f = recordingFetcher([
      { rid: 1, full_update: true, torrents: { aaa: {}, bbb: {} } },
      { rid: 2, torrents_removed: ["aaa"] },
    ]);

    await fetchMaindata(config, { fetchJson: f.fetchJson });
    setLastMaindataSnapshot(null);
    const second = await fetchMaindata(config, { fetchJson: f.fetchJson });

    expect([...second.torrents.keys()]).toEqual(["bbb"]);
  });
});

describe("qbittorrent adapter reuses the cursor", () => {
  beforeEach(() => {
    resetMaindataState();
    setLastMaindataSnapshot(null);
  });

  it("does not reset the cursor between listTorrents calls", async () => {
    const f = recordingFetcher([
      { rid: 7, full_update: true, torrents: { aaa: { progress: 0.1 } } },
      { rid: 11, torrents: { aaa: { progress: 0.2 } } },
    ]);
    const adapter = createQbittorrentAdapter(config, {
      maindata: { fetchJson: f.fetchJson },
    });

    await adapter.listTorrents();
    setLastMaindataSnapshot(null);
    await adapter.listTorrents();

    expect(f.paths).toEqual([
      "/api/v2/sync/maindata?rid=0",
      "/api/v2/sync/maindata?rid=7",
    ]);
    expect(getMaindataState()?.rid).toBe(11);
  });

  it("getTorrent returns the matching entry from a multi-torrent projection", async () => {
    const f = recordingFetcher([
      {
        rid: 1,
        full_update: true,
        torrents: {
          AAA: { name: "first" },
          bbb: { name: "second" },
          ccc: { name: "third" },
        },
      },
    ]);
    const adapter = createQbittorrentAdapter(config, {
      maindata: { fetchJson: f.fetchJson },
    });

    const found = await adapter.getTorrent("aaa");

    expect(found?.hash.toLowerCase()).toBe("aaa");
  });
});

// Regression: the reuse-window snapshot is keyed by time, so without a config
// guard a client swap serves the previous client's torrents — and a connection
// test against a new endpoint can pass without ever contacting it.
describe("maindata cache is keyed to a client, not just a moment", () => {
  beforeEach(() => {
    resetMaindataState();
    setLastMaindataSnapshot(null);
  });

  it("does not serve one client's torrents to another inside the reuse window", async () => {
    const a = recordingFetcher([
      { rid: 4, full_update: true, torrents: { aaaa: { name: "from-A" } } },
    ]);
    const b = recordingFetcher([
      { rid: 9, full_update: true, torrents: { bbbb: { name: "from-B" } } },
    ]);

    const first = await fetchMaindata(config, { fetchJson: a.fetchJson });
    expect([...first.torrents.keys()]).toEqual(["aaaa"]);

    // No setLastMaindataSnapshot(null): stay inside the 750ms reuse window on
    // purpose, which is exactly when the stale read used to happen.
    const other = { ...config, website_url: "http://localhost:9090" };
    const second = await fetchMaindata(other, { fetchJson: b.fetchJson });

    expect([...second.torrents.keys()]).toEqual(["bbbb"]);
    expect(b.paths).toEqual(["/api/v2/sync/maindata?rid=0"]);
  });

  it("keeps reusing the snapshot while the client is unchanged", async () => {
    const f = recordingFetcher([
      { rid: 1, full_update: true, torrents: { cccc: {} } },
    ]);
    await fetchMaindata(config, { fetchJson: f.fetchJson });
    await fetchMaindata(config, { fetchJson: f.fetchJson });
    expect(f.paths).toHaveLength(1);
  });
});
