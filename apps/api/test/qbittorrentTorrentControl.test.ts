import { describe, it, expect, mock, afterAll } from "bun:test";
import type { QbittorrentIntegrationConfig } from "@rawkoon/api/services/qbittorrent/clientTypes";

// Capture every qbFetch call so we can assert path + fallback behavior.
const calls: Array<{ path: string }> = [];
// Paths the fake qB server "rejects" (simulates 5.x where /pause 404s, or 4.x where /stop 404s).
let rejectPaths: string[] = [];

mock.module("@rawkoon/api/services/qbittorrent/clientFetch", () => ({
  qbFetchText: async (_cfg: unknown, path: string) => {
    calls.push({ path });
    if (rejectPaths.includes(path)) throw new Error(`404 ${path}`);
    return "";
  },
  qbFetchJson: async (_cfg: unknown, path: string) => {
    calls.push({ path });
    // /torrents/info?hashes=h1|h2 — return two torrents keyed by hash.
    return [
      {
        hash: "h1",
        name: "A",
        progress: 0.43,
        dlspeed: 8000000,
        eta: 360,
        state: "downloading",
        size: 100,
      },
      {
        hash: "h2",
        name: "B",
        progress: 0.71,
        dlspeed: 0,
        eta: -1,
        state: "pausedDL",
        size: 100,
      },
    ];
  },
  fetchMaindata: async () => ({ torrents: new Map() }),
}));

const { pauseQbittorrentTorrent, resumeQbittorrentTorrent } = await import(
  "@rawkoon/api/services/qbittorrent/torrentMutations"
);
const { fetchQbittorrentTorrents } = await import(
  "@rawkoon/api/services/qbittorrent/torrentQueries"
);

afterAll(() => mock.restore());

const CFG = {} as QbittorrentIntegrationConfig;

describe("qBittorrent torrent control", () => {
  it("pause hits /stop (5.x) first", async () => {
    calls.length = 0;
    rejectPaths = [];
    const res = await pauseQbittorrentTorrent(CFG, true, { hash: "h1" });
    expect(res.success).toBe(true);
    expect(calls[0].path).toBe("/api/v2/torrents/stop");
  });

  it("pause falls back to /pause (4.x) when /stop 404s", async () => {
    calls.length = 0;
    rejectPaths = ["/api/v2/torrents/stop"];
    const res = await pauseQbittorrentTorrent(CFG, true, { hash: "h1" });
    expect(res.success).toBe(true);
    expect(calls.map((c) => c.path)).toEqual([
      "/api/v2/torrents/stop",
      "/api/v2/torrents/pause",
    ]);
  });

  it("resume falls back to /resume when /start 404s", async () => {
    calls.length = 0;
    rejectPaths = ["/api/v2/torrents/start"];
    const res = await resumeQbittorrentTorrent(CFG, true, { hash: "h1" });
    expect(res.success).toBe(true);
    expect(calls.map((c) => c.path)).toEqual([
      "/api/v2/torrents/start",
      "/api/v2/torrents/resume",
    ]);
  });

  it("pause with no hash errors without calling qB", async () => {
    calls.length = 0;
    const res = await pauseQbittorrentTorrent(CFG, true, { hash: "  " });
    expect(res.success).toBe(false);
    expect(calls.length).toBe(0);
  });

  it("disabled integration is a no-op", async () => {
    const res = await pauseQbittorrentTorrent(CFG, false, { hash: "h1" });
    expect(res).toEqual({ enabled: false, connected: false, success: false });
  });

  it("batch info returns normalized torrents", async () => {
    calls.length = 0;
    const res = await fetchQbittorrentTorrents(CFG, true, ["h1", "h2"]);
    expect(res.connected).toBe(true);
    expect(calls[0].path).toContain("hashes=h1|h2");
    expect(res.torrents.map((t) => t.id)).toEqual(["h1", "h2"]);
    expect(res.torrents[0].progress).toBeCloseTo(0.43);
    expect(res.torrents[1].state).toBe("pausedDL");
  });

  it("batch info with empty hashes skips the call", async () => {
    const res = await fetchQbittorrentTorrents(CFG, true, []);
    expect(res.connected).toBe(true);
    expect(res.torrents).toEqual([]);
  });
});
