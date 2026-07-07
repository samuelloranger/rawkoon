import { describe, it, expect, beforeEach, mock } from "bun:test";

// Regression test for /qbittorrent/added candidate filtering.
//
// Pre-fix: the title-match candidate query filtered libraryMedia by
// `status IN ('wanted','downloading')`. Once a series had any episode
// imported the show row flipped to `downloaded` — and from then on every new
// episode torrent that landed in qBit was logged as "No library match",
// silently dropping the download from Rawkoon's tracking pipeline.
//
// Post-fix: shows are matched regardless of media status; movies still keep
// the status filter (one-shot, no follow-up episodes).

const SHOW_HASH = "a".repeat(40);
const MOVIE_HASH = "b".repeat(40);

type MediaRow = {
  id: number;
  title: string;
  type: "movie" | "show";
  status: string;
  qualityProfileId: number | null;
};

const state: {
  media: MediaRow[];
  episodes: Array<{ id: number; mediaId: number; status: string }>;
  downloadHistories: Array<{
    id: number;
    torrentHash: string | null;
    mediaId: number | null;
  }>;
  qbTorrents: Record<string, { name: string; category: string; tags: string }>;
  lastCandidateWhere: Record<string, unknown> | null;
  createdDh: Array<Record<string, unknown>>;
  mediaUpdates: Array<{ id: number; data: Record<string, unknown> }>;
  episodeUpdateManyArgs: Record<string, unknown> | null;
} = {
  media: [],
  episodes: [],
  downloadHistories: [],
  qbTorrents: {},
  lastCandidateWhere: null,
  createdDh: [],
  mediaUpdates: [],
  episodeUpdateManyArgs: null,
};

const WEBHOOK_SECRET = "test-secret-123";

mock.module("@rawkoon/api/db", () => ({
  prisma: {
    libraryMedia: {
      findMany: ({ where }: { where: Record<string, unknown> }) => {
        state.lastCandidateWhere = where;
        return Promise.resolve(
          state.media.filter((m) => {
            if (where.type && m.type !== where.type) return false;
            const statusFilter = where.status as { in?: string[] } | undefined;
            if (
              statusFilter &&
              Array.isArray(statusFilter.in) &&
              !statusFilter.in.includes(m.status)
            ) {
              return false;
            }
            return true;
          }),
        );
      },
      update: ({
        where,
        data,
      }: {
        where: { id: number };
        data: Record<string, unknown>;
      }) => {
        state.mediaUpdates.push({ id: where.id, data });
        return Promise.resolve({});
      },
    },
    libraryEpisode: {
      updateMany: (args: Record<string, unknown>) => {
        state.episodeUpdateManyArgs = args;
        return Promise.resolve({ count: state.episodes.length });
      },
    },
    libraryBook: {
      findMany: () => Promise.resolve([]),
      update: () => Promise.resolve({}),
    },
    downloadHistory: {
      findFirst: ({ where }: { where: { torrentHash?: string } }) => {
        const match = state.downloadHistories.find(
          (d) => d.torrentHash === where.torrentHash,
        );
        return Promise.resolve(match ?? null);
      },
      create: ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: state.createdDh.length + 1000, ...data };
        state.createdDh.push(row);
        return Promise.resolve(row);
      },
    },
  },
}));

const realQbConfig = await import("@rawkoon/api/services/qbittorrent/config");
mock.module("@rawkoon/api/services/qbittorrent/config", () => ({
  ...realQbConfig,
  getQbittorrentIntegrationConfig: () =>
    Promise.resolve({
      enabled: true,
      config: { webhook_secret: WEBHOOK_SECRET },
    }),
}));

const realQbClient =
  await import("@rawkoon/api/services/qbittorrent/clientFetch");
mock.module("@rawkoon/api/services/qbittorrent/clientFetch", () => ({
  ...realQbClient,
  qbFetchJson: (_cfg: unknown, url: string): Promise<unknown> => {
    // Expect /api/v2/torrents/info?hashes=<hash>
    const m = url.match(/hashes=([a-f0-9]+)/i);
    if (!m) return Promise.resolve([]);
    const hash = m[1]!.toLowerCase();
    const t = state.qbTorrents[hash];
    return Promise.resolve(
      t ? [{ name: t.name, category: t.category, tags: t.tags }] : [],
    );
  },
}));

// Heavy graph trims — nothing downstream is exercised in these tests.
// cache / postProcessor / checkDownloadCompletion are imported by the
// webhooks plugin but only invoked by routes this test doesn't exercise
// (/qbittorrent/completed). Their real implementations load fine and stay
// dormant — mocking them with stripped surfaces would bleed into other test
// files under bun's process-global mock.module.

const { webhooksRoutes } = await import("@rawkoon/api/routes/webhooks");

async function fireAdded(hash: string): Promise<Response> {
  const req = new Request(
    `http://localhost/api/webhooks/qbittorrent/added?hash=${hash}`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${WEBHOOK_SECRET}` },
    },
  );
  return webhooksRoutes.handle(req);
}

describe("/qbittorrent/added candidate filter", () => {
  beforeEach(() => {
    state.media = [];
    state.episodes = [];
    state.downloadHistories = [];
    state.qbTorrents = {};
    state.lastCandidateWhere = null;
    state.createdDh = [];
    state.mediaUpdates = [];
    state.episodeUpdateManyArgs = null;
  });

  it("matches a NEW episode torrent for a show whose status is already 'downloaded'", async () => {
    // Show row already flipped to 'downloaded' after an earlier episode
    // landed; a new episode torrent arrives. Pre-fix this returned
    // matched=false ("No library match").
    state.media.push({
      id: 1,
      title: "Example Show",
      type: "show",
      status: "downloaded",
      qualityProfileId: 1,
    });
    state.qbTorrents[SHOW_HASH] = {
      name: "Example.Show.S01E02.1080p.WEB.x264-GROUP",
      category: "rawkoon-shows",
      tags: "",
    };

    const res = await fireAdded(SHOW_HASH);
    const body = (await res.json()) as { matched: boolean };
    expect(res.status).toBe(200);
    expect(body.matched).toBe(true);

    // The candidate query for SHOWS must not constrain status.
    expect(state.lastCandidateWhere).toEqual({ type: "show" });

    // A DH row was created and the show was flipped to downloading.
    expect(state.createdDh).toHaveLength(1);
    expect(state.mediaUpdates).toEqual([
      { id: 1, data: { status: "downloading" } },
    ]);
    // Episode flip is now narrowed to the parsed season+episode, not the
    // whole show — release name was "Example.Show.S01E02.*"
    expect(state.episodeUpdateManyArgs).toEqual({
      where: { mediaId: 1, status: "wanted", season: 1, episode: 2 },
      data: { status: "downloading" },
    });
  });

  it("prefers an actively-tracked show over a 'downloaded' one on cross-title collisions", async () => {
    // Two shows whose normalized titles both appear as contiguous word
    // sequences in the torrent name. Pre-fix, findFirst order decided.
    // Post-fix, the `wanted` candidate wins over the `downloaded` one.
    state.media.push({
      id: 100,
      title: "Lens",
      type: "show",
      status: "downloaded",
      qualityProfileId: 1,
    });
    state.media.push({
      id: 101,
      title: "Lens Flare",
      type: "show",
      status: "wanted",
      qualityProfileId: 1,
    });
    state.qbTorrents[SHOW_HASH] = {
      name: "Lens.Flare.S01E01.1080p.WEB.x264-GROUP",
      category: "rawkoon-shows",
      tags: "",
    };

    const res = await fireAdded(SHOW_HASH);
    const body = (await res.json()) as { matched: boolean };
    expect(res.status).toBe(200);
    expect(body.matched).toBe(true);

    // Show 101 ("Lens Flare", status=wanted) must win.
    expect(state.mediaUpdates).toEqual([
      { id: 101, data: { status: "downloading" } },
    ]);
    expect(state.createdDh).toHaveLength(1);
    expect((state.createdDh[0] as { mediaId?: number }).mediaId).toBe(101);
  });

  it("falls back to a `downloaded` match when no actively-tracked candidate exists", async () => {
    state.media.push({
      id: 200,
      title: "Old Show",
      type: "show",
      status: "downloaded",
      qualityProfileId: 1,
    });
    state.qbTorrents[SHOW_HASH] = {
      name: "Old.Show.S05E01.1080p.WEB.x264-GROUP",
      category: "rawkoon-shows",
      tags: "",
    };

    const res = await fireAdded(SHOW_HASH);
    const body = (await res.json()) as { matched: boolean };
    expect(res.status).toBe(200);
    expect(body.matched).toBe(true);
    expect(state.mediaUpdates).toEqual([
      { id: 200, data: { status: "downloading" } },
    ]);
  });

  it("falls back to a season-wide episode flip when SxxExx can't be parsed", async () => {
    // Cryptic release name with no parseable season/episode. The whole-show
    // wanted episodes still need to flip so the UI reflects activity —
    // there's no other signal available.
    state.media.push({
      id: 300,
      title: "Cryptic Show",
      type: "show",
      status: "wanted",
      qualityProfileId: 1,
    });
    state.qbTorrents[SHOW_HASH] = {
      name: "Cryptic.Show.Complete.Pack.WEB-DL-GROUP",
      category: "rawkoon-shows",
      tags: "",
    };

    const res = await fireAdded(SHOW_HASH);
    expect(res.status).toBe(200);
    expect(state.episodeUpdateManyArgs).toEqual({
      where: { mediaId: 300, status: "wanted" },
      data: { status: "downloading" },
    });
  });

  it("narrows the episode flip to the parsed season when episode is unknown", async () => {
    // "Season pack" style: SxxExx unavailable but season is. Flip every
    // wanted episode in THAT season, not the whole show.
    state.media.push({
      id: 400,
      title: "Season Pack Show",
      type: "show",
      status: "wanted",
      qualityProfileId: 1,
    });
    state.qbTorrents[SHOW_HASH] = {
      name: "Season.Pack.Show.Season.3.COMPLETE.WEB-DL-GROUP",
      category: "rawkoon-shows",
      tags: "",
    };

    const res = await fireAdded(SHOW_HASH);
    expect(res.status).toBe(200);
    expect(state.episodeUpdateManyArgs).toEqual({
      where: { mediaId: 400, status: "wanted", season: 3 },
      data: { status: "downloading" },
    });
  });

  it("keeps the status filter for MOVIES (one-shot — no follow-up episodes)", async () => {
    state.media.push({
      id: 2,
      title: "Example Movie",
      type: "movie",
      status: "downloaded",
      qualityProfileId: 1,
    });
    state.qbTorrents[MOVIE_HASH] = {
      name: "Example.Movie.2024.1080p.BluRay.x264-GROUP",
      category: "rawkoon-movies",
      tags: "",
    };

    const res = await fireAdded(MOVIE_HASH);
    const body = (await res.json()) as { matched: boolean; reason?: string };
    expect(res.status).toBe(200);
    // Movie with status='downloaded' must NOT match (filter still applies).
    expect(body.matched).toBe(false);

    expect(state.lastCandidateWhere).toEqual({
      type: "movie",
      status: { in: ["wanted", "downloading"] },
    });
    expect(state.createdDh).toHaveLength(0);
  });

  it("short-circuits when an existing DH already tracks the hash", async () => {
    state.downloadHistories.push({
      id: 42,
      torrentHash: SHOW_HASH,
      mediaId: 1,
    });
    state.qbTorrents[SHOW_HASH] = {
      name: "Example.Show.S01E02.1080p.WEB.x264-GROUP",
      category: "rawkoon-shows",
      tags: "",
    };

    const res = await fireAdded(SHOW_HASH);
    const body = (await res.json()) as {
      matched: boolean;
      reason?: string;
      download_history_id?: number;
    };
    expect(res.status).toBe(200);
    expect(body.matched).toBe(true);
    expect(body.reason).toBe("Already tracked");
    expect(body.download_history_id).toBe(42);
    // No new DH row, no candidate query.
    expect(state.createdDh).toHaveLength(0);
    expect(state.lastCandidateWhere).toBeNull();
  });
});
