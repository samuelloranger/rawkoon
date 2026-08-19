import { describe, it, expect, beforeEach, mock } from "bun:test";

/**
 * Regression: Toy Story 5 (media 2463) was grabbed twice on 2026-08-18 04:00Z.
 * check-library-movie-releases (every 6 hours, on the hour) and
 * poll-indexer-rss both fired on the same tick off the same
 * "wanted + no files" snapshot; the RSS poller
 * spent 20s in its local-AI pick, so by the time it grabbed, the other job had
 * already handed a torrent to the download client. grabRelease had no in-flight
 * check, so both grabs went through.
 */

type ActiveGrab = { id: number } | null;

let activeGrab: ActiveGrab = null;
let createError: unknown = null;
const createCalls: Record<string, unknown>[] = [];
const findFirstWhere: Record<string, unknown>[] = [];
const addedTorrents: unknown[] = [];

mock.module("@rawkoon/api/db", () => ({
  prisma: {
    libraryMedia: {
      findUnique: async () => ({
        id: 2463,
        type: "movie",
        title: "Toy Story 5",
      }),
      update: async () => ({ id: 2463 }),
    },
    libraryEpisode: {
      update: async () => ({ id: 1 }),
    },
    grabBlocklist: {
      findFirst: async () => null,
    },
    downloadHistory: {
      findFirst: async (args: { where: Record<string, unknown> }) => {
        findFirstWhere.push(args.where);
        return activeGrab;
      },
      create: async (args: { data: Record<string, unknown> }) => {
        createCalls.push(args.data);
        if (createError) throw createError;
        return { id: 9001 };
      },
      update: async () => ({ id: 9001 }),
    },
    activityLog: {
      create: async () => ({ id: 1 }),
    },
  },
}));

mock.module("@rawkoon/api/services/downloadClient/registry", () => ({
  resolveActiveAdapter: async () => ({
    label: "qbittorrent",
    savePath: "/downloads",
    adapter: {
      type: "qbittorrent",
      addTorrent: async (args: unknown) => {
        addedTorrents.push(args);
        return { hash: "deadbeef" };
      },
    },
  }),
}));

const { grabRelease } = await import("@rawkoon/api/services/mediaGrabberGrab");

const MAGNET = "magnet:?xt=urn:btih:aaaabbbbccccddddeeeeffff0000111122223333";

beforeEach(() => {
  activeGrab = null;
  createError = null;
  createCalls.length = 0;
  findFirstWhere.length = 0;
  addedTorrents.length = 0;
});

describe("grabRelease duplicate-grab guard", () => {
  it("grabs when no other download is active for the target", async () => {
    const result = await grabRelease({
      mediaId: 2463,
      downloadUrl: MAGNET,
      releaseTitle: "Toy.Story.5.2026.MULTi.VFQ.1080p.WEBRip.x265-GL0P",
    });

    expect(result.grabbed).toBe(true);
    expect(createCalls).toHaveLength(1);
    expect(addedTorrents).toHaveLength(1);
  });

  it("refuses a second grab while one is already active for the same movie", async () => {
    activeGrab = { id: 1168 };

    const result = await grabRelease({
      mediaId: 2463,
      downloadUrl: MAGNET,
      releaseTitle: "Toy.Story.5.2026.MULTI.VF2.1080p.WEB.H264-SUPPLY",
    });

    expect(result.grabbed).toBe(false);
    expect(result.grabbed === false && result.reason).toContain(
      "already active",
    );
    expect(result.grabbed === false && result.reason).toContain("1168");
    // Nothing was written and nothing reached the download client.
    expect(createCalls).toHaveLength(0);
    expect(addedTorrents).toHaveLength(0);
  });

  it("keys the active-grab lookup on media + episode + season", async () => {
    await grabRelease({
      mediaId: 2463,
      episodeId: 77,
      downloadUrl: MAGNET,
      releaseTitle: "Show.S01E02.1080p.WEB-DL",
    });

    expect(findFirstWhere[0]).toEqual({
      mediaId: 2463,
      episodeId: 77,
      season: null,
      completedAt: null,
      failed: false,
    });
  });

  it("persists season so two packs for different seasons stay independent", async () => {
    await grabRelease({
      mediaId: 500,
      season: 3,
      downloadUrl: MAGNET,
      releaseTitle: "Show.S03.1080p.WEB-DL",
    });

    expect(findFirstWhere[0]).toMatchObject({
      mediaId: 500,
      episodeId: null,
      season: 3,
    });
    expect(createCalls[0]).toMatchObject({
      mediaId: 500,
      episodeId: null,
      season: 3,
    });
  });

  it("treats a P2002 on the unique index as a duplicate, not a crash", async () => {
    // The pre-check passed but a concurrent grab inserted first — this is the
    // exact 20s-apart race the two crons produced.
    createError = Object.assign(new Error("Unique constraint failed"), {
      code: "P2002",
    });

    const result = await grabRelease({
      mediaId: 2463,
      downloadUrl: MAGNET,
      releaseTitle: "Toy.Story.5.2026.MULTI.VF2.1080p.WEB.H264-SUPPLY",
    });

    expect(result.grabbed).toBe(false);
    expect(result.grabbed === false && result.reason).toContain(
      "already active",
    );
    expect(addedTorrents).toHaveLength(0);
  });
});
