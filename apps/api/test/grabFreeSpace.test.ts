import { describe, it, expect, beforeEach, mock } from "bun:test";
import { tmpdir } from "node:os";
import { dbModule } from "./mocks/prisma";
import { makeNotifyLibraryEventsMock } from "./mocks/notifyLibraryEvents";

// Real statfs on a real directory: the free-space figure is the machine's, so
// the tests force each outcome through the size / minimum-to-keep settings.
type Settings = {
  minFreeSpaceGb: number;
  downloadsPath: string | null;
  moviesLibraryPath: string | null;
  showsLibraryPath: string | null;
} | null;

let settings: Settings;
const blocklistWrites: unknown[] = [];
const createCalls: unknown[] = [];
const addedTorrents: unknown[] = [];

mock.module("@rawkoon/api/workers/notifyLibraryEvents", () =>
  makeNotifyLibraryEventsMock(),
);
mock.module("@rawkoon/api/db", () =>
  dbModule({
    prisma: {
      mediaSettings: { findUnique: async () => settings },
      libraryMedia: {
        findUnique: async () => ({
          id: 42,
          type: "movie",
          title: "Some Movie",
        }),
        update: async () => ({}),
      },
      libraryEpisode: { update: async () => ({}) },
      grabBlocklist: {
        findFirst: async () => null,
        create: async (a: unknown) => {
          blocklistWrites.push(a);
          return {};
        },
      },
      downloadHistory: {
        findFirst: async () => null,
        create: async (a: unknown) => {
          createCalls.push(a);
          return { id: 9001 };
        },
        update: async () => ({ id: 9001 }),
      },
      activityLog: { create: async () => ({ id: 1 }) },
    },
  }),
);

mock.module("@rawkoon/api/services/downloadClient/registry", () => ({
  resolveActiveAdapter: async () => ({
    label: "qbittorrent",
    savePath: "/downloads",
    adapter: {
      type: "qbittorrent",
      addTorrent: async (a: unknown) => {
        addedTorrents.push(a);
        return { hash: "deadbeef" };
      },
    },
  }),
}));

const { grabRelease } = await import(
  "@rawkoon/api/services/mediaGrabber/mediaGrabberGrab"
);

const MAGNET = "magnet:?xt=urn:btih:aaaabbbbccccddddeeeeffff0000111122223333";
const GB = 1024 ** 3;
const base = {
  mediaId: 42,
  downloadUrl: MAGNET,
  releaseTitle: "Some.Movie.2026.2160p.REMUX",
};

const cfg = (over: Partial<NonNullable<Settings>> = {}): Settings => ({
  minFreeSpaceGb: 10,
  downloadsPath: tmpdir(),
  moviesLibraryPath: null,
  showsLibraryPath: null,
  ...over,
});

beforeEach(() => {
  settings = cfg();
  blocklistWrites.length = 0;
  createCalls.length = 0;
  addedTorrents.length = 0;
});

describe("grabRelease free-space check", () => {
  it("grabs a release that fits", async () => {
    // A 1 KB minimum still runs the check, but fits on any machine's temp volume
    settings = cfg({ minFreeSpaceGb: 1 / 1024 ** 2 });
    const r = await grabRelease({ ...base, sizeBytes: 1024 });
    expect(r.grabbed).toBe(true);
    expect(addedTorrents).toHaveLength(1);
  });

  it("refuses a release that would leave too little free, without blocklisting", async () => {
    const r = await grabRelease({ ...base, sizeBytes: 1024 ** 6 });
    expect(r.grabbed).toBe(false);
    expect(r.grabbed === false && r.reason).toMatch(
      /^Not enough free space: needs .* GB, .* GB free, keeping 10 GB$/,
    );
    expect(addedTorrents).toHaveLength(0);
    expect(createCalls).toHaveLength(0);
    expect(blocklistWrites).toHaveLength(0);
  });

  it("refuses when the minimum alone exceeds what is free", async () => {
    settings = cfg({ minFreeSpaceGb: 1024 ** 3 });
    const r = await grabRelease({ ...base, sizeBytes: 1 * GB });
    expect(r.grabbed).toBe(false);
  });

  it("skips the check when the minimum is 0", async () => {
    settings = cfg({ minFreeSpaceGb: 0 });
    const r = await grabRelease({ ...base, sizeBytes: 1024 ** 6 });
    expect(r.grabbed).toBe(true);
  });

  it("allows an unknown release size", async () => {
    for (const sizeBytes of [undefined, null, 0]) {
      const r = await grabRelease({ ...base, sizeBytes });
      expect(r.grabbed).toBe(true);
    }
  });

  it("allows the grab when statfs fails", async () => {
    settings = cfg({ downloadsPath: "/definitely/not/a/real/path" });
    const r = await grabRelease({ ...base, sizeBytes: 1024 ** 6 });
    expect(r.grabbed).toBe(true);
  });

  it("falls back to the library path when no downloads path is set", async () => {
    settings = cfg({ downloadsPath: null, moviesLibraryPath: tmpdir() });
    const r = await grabRelease({ ...base, sizeBytes: 1024 ** 6 });
    expect(r.grabbed).toBe(false);
  });
});
