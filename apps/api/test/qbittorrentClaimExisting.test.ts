import { beforeEach, describe, expect, it, mock } from "bun:test";
import { claimExistingTorrent } from "@rawkoon/api/services/downloadClient/claimExisting";
import { fakeAdapter } from "./mocks/downloadClientAdapter";

const state: {
  torrent: {
    category?: string;
    tags?: string[];
    state?: string;
    progress?: number;
  } | null;
  categoryCalls: Array<Record<string, unknown>>;
  tagCalls: Array<Record<string, unknown>>;
  categoryOk: boolean;
} = { torrent: null, categoryCalls: [], tagCalls: [], categoryOk: true };

// Spread the real modules: bun's mock.module is process-global.
const realQueries = await import(
  "@rawkoon/api/services/qbittorrent/torrentQueries"
);
const realMutations = await import(
  "@rawkoon/api/services/qbittorrent/torrentMutations"
);
mock.module("@rawkoon/api/services/qbittorrent/torrentQueries", () => ({
  ...realQueries,
  fetchQbittorrentTorrent: () => Promise.resolve({ torrent: state.torrent }),
}));
mock.module("@rawkoon/api/services/qbittorrent/torrentMutations", () => ({
  ...realMutations,
  setQbittorrentTorrentCategory: (
    _cfg: unknown,
    _enabled: boolean,
    args: Record<string, unknown>,
  ) => {
    state.categoryCalls.push(args);
    return Promise.resolve(
      state.categoryOk
        ? { success: true }
        : { success: false, error: "qb refused" },
    );
  },
  setQbittorrentTorrentTags: (
    _cfg: unknown,
    _enabled: boolean,
    args: Record<string, unknown>,
  ) => {
    state.tagCalls.push(args);
    return Promise.resolve({ success: true });
  },
}));

const { claimExistingQbTorrent } = await import(
  "@rawkoon/api/services/qbittorrent/adoptExisting"
);

const config = { website_url: "http://qb", username: "u", password: "p" };
const opts = {
  hash: "a".repeat(40),
  category: "rawkoon-movies",
  logPrefix: "t",
};

describe("claimExistingQbTorrent", () => {
  beforeEach(() => {
    state.torrent = {
      category: "other",
      tags: [],
      state: "uploading",
      progress: 1,
    };
    state.categoryCalls = [];
    state.tagCalls = [];
    state.categoryOk = true;
  });

  it("sets the category and the rawkoon tag, and reports completion", async () => {
    expect(await claimExistingQbTorrent(config, opts)).toEqual({
      completed: true,
    });
    expect(state.categoryCalls[0]?.category).toBe("rawkoon-movies");
    expect(state.tagCalls[0]?.tags).toEqual(["rawkoon"]);
  });

  it("leaves a matching category and existing tag alone", async () => {
    state.torrent = {
      category: "rawkoon-movies",
      tags: ["rawkoon"],
      state: "downloading",
      progress: 0.5,
    };
    expect(await claimExistingQbTorrent(config, opts)).toEqual({
      completed: false,
    });
    expect(state.categoryCalls).toEqual([]);
    expect(state.tagCalls).toEqual([]);
  });

  it("returns null when the torrent is absent", async () => {
    state.torrent = null;
    expect(await claimExistingQbTorrent(config, opts)).toBeNull();
  });

  // A torrent left in a category nothing watches would be unmanaged.
  it("returns null when the category could not be set", async () => {
    state.categoryOk = false;
    expect(await claimExistingQbTorrent(config, opts)).toBeNull();
    expect(state.tagCalls).toEqual([]);
  });
});

describe("claimExistingTorrent", () => {
  it("returns null without a hash or when the client cannot claim", async () => {
    let called = false;
    const supported = fakeAdapter({
      claimExisting: async () => {
        called = true;
        return { completed: false };
      },
    });
    expect(
      await claimExistingTorrent(supported, { ...opts, hash: null }),
    ).toBeNull();
    expect(called).toBe(false);
    expect(await claimExistingTorrent(fakeAdapter(), opts)).toBeNull();
    expect(await claimExistingTorrent(supported, opts)).toEqual({
      completed: false,
    });
  });
});
