import { describe, it, expect, beforeEach, mock } from "bun:test";
import { dbModule } from "./mocks/prisma";
import { makeNotifyLibraryEventsMock } from "./mocks/notifyLibraryEvents";

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
  releaseTitle: string;
};

let activeGrab: ActiveGrab = null;
let episodeSeason = 2;
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

mock.module("@rawkoon/api/workers/notifyLibraryEvents", () =>
  makeNotifyLibraryEventsMock(),
);
mock.module("@rawkoon/api/db", () =>
  dbModule({
    prisma: {
      libraryMedia: {
        findUnique: async () => mediaRow,
        update: async () => mediaRow,
      },
      libraryEpisode: {
        findUnique: async () => ({ season: episodeSeason }),
        update: async () => ({ id: 1 }),
      },
      grabBlocklist: {
        findFirst: async () => null,
      },
      downloadHistory: {
        findFirst: async (args: { where: Record<string, unknown> }) => {
          findFirstWhere.push(args.where);
          if (activeGrab) return activeGrab;
          const found = createdRows.find((row) =>
            matchesTarget(row, args.where),
          );
          return found ? { id: found.id } : null;
        },
        findMany: async (args: {
          where: { mediaId: number | { in: number[] } };
        }) => {
          const ids = args.where.mediaId;
          if (typeof ids === "number") {
            // Season- and episode-level rows in flight for one show.
            return createdRows
              .filter(
                (row) =>
                  row.mediaId === ids &&
                  (row.episodeId !== null || row.season !== null),
              )
              .map((row) => ({
                season: row.season,
                episode: row.episodeId ? { season: episodeSeason } : null,
              }));
          }
          return createdRows
            .filter(
              (row) =>
                ids.in.includes(row.mediaId) &&
                row.episodeId === null &&
                row.season === null,
            )
            .map((row) => ({
              mediaId: row.mediaId,
              releaseTitle: row.releaseTitle,
            }));
        },
        create: async (args: { data: Record<string, unknown> }) => {
          createCalls.push(args.data);
          if (createError) throw createError;
          const row: HistoryRow = {
            id: nextHistoryId++,
            mediaId: args.data.mediaId as number,
            episodeId: (args.data.episodeId as number | null) ?? null,
            season: (args.data.season as number | null) ?? null,
            releaseTitle: args.data.releaseTitle as string,
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
  }),
);

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
  episodeSeason = 2;
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

describe("grabRelease complete-series pack", () => {
  beforeEach(() => {
    mediaRow = { id: 500, type: "show", title: "Show" };
  });

  it.each([
    "Show.S01-S03.COMPLETE.1080p.WEB",
    "Show.Integrale.MULTi.1080p.WEB",
  ])(
    "records %s as a show-level target, not as season 1",
    async (releaseTitle) => {
      const result = await grabRelease({
        mediaId: 500,
        downloadUrl: MAGNET,
        releaseTitle,
      });

      expect(result.grabbed).toBe(true);
      expect(createCalls[0]).toMatchObject({
        mediaId: 500,
        episodeId: null,
        season: null,
      });
    },
  );

  it("refuses a season pack or an episode while the complete pack is active", async () => {
    await grabRelease({
      mediaId: 500,
      downloadUrl: MAGNET,
      releaseTitle: "Show.S01-S03.COMPLETE.1080p.WEB",
    });
    const season = await grabRelease({
      mediaId: 500,
      downloadUrl: MAGNET,
      releaseTitle: "Show.S02.1080p.WEB-DL",
    });
    const episode = await grabRelease({
      mediaId: 500,
      episodeId: 77,
      downloadUrl: MAGNET,
      releaseTitle: "Show.S02E03.1080p.WEB-DL",
    });

    for (const r of [season, episode]) {
      expect(r.grabbed).toBe(false);
      expect(r.grabbed === false && r.reason).toContain("complete-series");
      expect(r.grabbed === false && r.refusal).toBe("show_grab_active");
    }
    expect(createCalls).toHaveLength(1);
    expect(addedTorrents).toHaveLength(1);
  });

  it("refuses a second complete pack while the first is downloading", async () => {
    const first = await grabRelease({
      mediaId: 500,
      downloadUrl: MAGNET,
      releaseTitle: "Show.Integrale.MULTi.1080p.WEB",
    });
    const second = await grabRelease({
      mediaId: 500,
      downloadUrl: MAGNET,
      releaseTitle: "Show.S01-S03.COMPLETE.720p.WEB",
    });
    expect(first.grabbed).toBe(true);
    expect(second.grabbed).toBe(false);
    expect(addedTorrents).toHaveLength(1);
  });

  it("only blocks the seasons a ranged pack names", async () => {
    await grabRelease({
      mediaId: 500,
      downloadUrl: MAGNET,
      releaseTitle: "Show.S01-S03.COMPLETE.1080p.WEB",
    });
    const season5 = await grabRelease({
      mediaId: 500,
      downloadUrl: MAGNET,
      releaseTitle: "Show.S05.1080p.WEB-DL",
    });
    episodeSeason = 5;
    const episode5 = await grabRelease({
      mediaId: 500,
      episodeId: 88,
      downloadUrl: MAGNET,
      releaseTitle: "Show.S05E01.1080p.WEB-DL",
    });
    const season2 = await grabRelease({
      mediaId: 500,
      downloadUrl: MAGNET,
      releaseTitle: "Show.S02.1080p.WEB-DL",
    });

    expect(season5.grabbed).toBe(true);
    expect(episode5.grabbed).toBe(true);
    expect(season2.grabbed).toBe(false);
  });

  it("refuses a show-level pack while a season pack inside its seasons is active", async () => {
    await grabRelease({
      mediaId: 500,
      downloadUrl: MAGNET,
      releaseTitle: "Show.S02.1080p.WEB-DL",
    });
    const result = await grabRelease({
      mediaId: 500,
      downloadUrl: MAGNET,
      releaseTitle: "Show.S01-S03.COMPLETE.1080p.WEB",
    });
    expect(result.grabbed).toBe(false);
    expect(result.grabbed === false && result.refusal).toBe("already_active");
    expect(addedTorrents).toHaveLength(1);
  });

  it("refuses an unranged complete pack while an episode grab is active", async () => {
    episodeSeason = 4;
    await grabRelease({
      mediaId: 500,
      episodeId: 9,
      downloadUrl: MAGNET,
      releaseTitle: "Show.S04E01.1080p.WEB-DL",
    });
    const result = await grabRelease({
      mediaId: 500,
      downloadUrl: MAGNET,
      releaseTitle: "Show.Integrale.MULTi.1080p.WEB",
    });
    expect(result.grabbed).toBe(false);
  });

  it("allows a ranged pack when the active season is outside it", async () => {
    await grabRelease({
      mediaId: 500,
      downloadUrl: MAGNET,
      releaseTitle: "Show.S05.1080p.WEB-DL",
    });
    const result = await grabRelease({
      mediaId: 500,
      downloadUrl: MAGNET,
      releaseTitle: "Show.S01-S03.COMPLETE.1080p.WEB",
    });
    expect(result.grabbed).toBe(true);
  });
});
