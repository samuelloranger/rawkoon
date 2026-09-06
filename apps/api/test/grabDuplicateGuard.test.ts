import { describe, it, expect, beforeEach, mock } from "bun:test";

/**
 * Regression: a wanted movie could be grabbed twice, seconds apart.
 * check-library-movie-releases (every 6 hours, on the hour) and
 * poll-indexer-rss shared the tick and the same "wanted + no files"
 * snapshot; the RSS poller spent tens of seconds in its local-AI pick, so
 * by the time it grabbed, the other job had already handed a torrent to the
 * download client. grabRelease had no in-flight check, so both went through.
 */

type ActiveGrab = { id: number } | null;
type HistoryRow = {
  id: number;
  mediaId: number;
  episodeId: number | null;
  season: number | null;
};

let activeGrab: ActiveGrab = null;
let createError: unknown = null;
let mediaRow = { id: 42, type: "movie", title: "Some Movie" };
let nextHistoryId = 9001;
const createdRows: HistoryRow[] = [];
const createCalls: Record<string, unknown>[] = [];
const findFirstWhere: Record<string, unknown>[] = [];
const addedTorrents: unknown[] = [];

function matchesTarget(
  row: HistoryRow,
  where: Record<string, unknown>,
): boolean {
  return (
    row.mediaId === where.mediaId &&
    row.episodeId === (where.episodeId ?? null) &&
    row.season === (where.season ?? null)
  );
}

mock.module("@rawkoon/api/db", () => ({
  prisma: {
    libraryMedia: {
      findUnique: async () => mediaRow,
      update: async () => mediaRow,
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
        if (activeGrab) return activeGrab;
        const found = createdRows.find((row) => matchesTarget(row, args.where));
        return found ? { id: found.id } : null;
      },
      create: async (args: { data: Record<string, unknown> }) => {
        createCalls.push(args.data);
        if (createError) throw createError;
        const row: HistoryRow = {
          id: nextHistoryId++,
          mediaId: args.data.mediaId as number,
          episodeId: (args.data.episodeId as number | null) ?? null,
          season: (args.data.season as number | null) ?? null,
        };
        createdRows.push(row);
        return { id: row.id };
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
  mediaRow = { id: 42, type: "movie", title: "Some Movie" };
  nextHistoryId = 9001;
  createdRows.length = 0;
  createCalls.length = 0;
  findFirstWhere.length = 0;
  addedTorrents.length = 0;
});

describe("grabRelease duplicate-grab guard", () => {
  it("grabs when no other download is active for the target", async () => {
    const result = await grabRelease({
      mediaId: 42,
      downloadUrl: MAGNET,
      releaseTitle: "Some.Movie.2026.1080p.WEBRip.x265-AAA",
    });

    expect(result.grabbed).toBe(true);
    expect(createCalls).toHaveLength(1);
    expect(addedTorrents).toHaveLength(1);
  });

  it("refuses a second grab while one is already active for the same movie", async () => {
    activeGrab = { id: 555 };

    const result = await grabRelease({
      mediaId: 42,
      downloadUrl: MAGNET,
      releaseTitle: "Some.Movie.2026.1080p.WEB.H264-BBB",
    });

    expect(result.grabbed).toBe(false);
    expect(result.grabbed === false && result.reason).toContain(
      "already active",
    );
    expect(result.grabbed === false && result.reason).toContain("555");
    // Nothing was written and nothing reached the download client.
    expect(createCalls).toHaveLength(0);
    expect(addedTorrents).toHaveLength(0);
  });

  it("keys the active-grab lookup on media + episode + season", async () => {
    await grabRelease({
      mediaId: 42,
      episodeId: 77,
      downloadUrl: MAGNET,
      releaseTitle: "Show.S01E02.1080p.WEB-DL",
    });

    expect(findFirstWhere[0]).toEqual({
      mediaId: 42,
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

  it("infers season from a pack title when the caller omits it", async () => {
    mediaRow = { id: 500, type: "show", title: "Show" };

    await grabRelease({
      mediaId: 500,
      downloadUrl: MAGNET,
      releaseTitle: "Show.S02.1080p.WEB-DL",
    });

    expect(findFirstWhere[0]).toMatchObject({
      mediaId: 500,
      episodeId: null,
      season: 2,
    });
    expect(createCalls[0]).toMatchObject({
      mediaId: 500,
      episodeId: null,
      season: 2,
    });
  });

  it("grabs a second season pack while another season of the same show is downloading", async () => {
    mediaRow = { id: 500, type: "show", title: "Show" };

    const season1 = await grabRelease({
      mediaId: 500,
      downloadUrl: MAGNET,
      releaseTitle: "Show.S01.1080p.WEB-DL",
    });
    const season2 = await grabRelease({
      mediaId: 500,
      downloadUrl: MAGNET,
      releaseTitle: "Show.S02.1080p.WEB-DL",
    });

    expect(season1.grabbed).toBe(true);
    expect(season2.grabbed).toBe(true);
    expect(addedTorrents).toHaveLength(2);
  });

  it("still refuses a second pack for the same season while the first is downloading", async () => {
    mediaRow = { id: 500, type: "show", title: "Show" };

    const first = await grabRelease({
      mediaId: 500,
      downloadUrl: MAGNET,
      releaseTitle: "Show.S01.1080p.WEB-DL",
    });
    const second = await grabRelease({
      mediaId: 500,
      downloadUrl: MAGNET,
      releaseTitle: "Show.S01.720p.WEB-DL",
    });

    expect(first.grabbed).toBe(true);
    expect(second.grabbed).toBe(false);
    expect(second.grabbed === false && second.reason).toContain(
      "already active",
    );
    expect(addedTorrents).toHaveLength(1);
  });

  it("treats a P2002 on the unique index as a duplicate, not a crash", async () => {
    // The pre-check passed but a concurrent grab inserted first — the exact
    // race the two colliding crons produced.
    createError = Object.assign(new Error("Unique constraint failed"), {
      code: "P2002",
    });

    const result = await grabRelease({
      mediaId: 42,
      downloadUrl: MAGNET,
      releaseTitle: "Some.Movie.2026.1080p.WEB.H264-BBB",
    });

    expect(result.grabbed).toBe(false);
    expect(result.grabbed === false && result.reason).toContain(
      "already active",
    );
    expect(addedTorrents).toHaveLength(0);
  });
});
