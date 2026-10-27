import { beforeEach, describe, expect, it, mock } from "bun:test";

type Row = {
  id: number;
  targetKey: string;
  mediaId: number;
  episodeId: number | null;
  season: number | null;
  release: Record<string, unknown>;
  score: number;
  source: string | null;
  grabAfter: Date;
  createdAt: Date;
};
let rows: Row[] = [];
let episode: unknown = null;
let media: unknown = null;
let blocklisted: { releaseTitle: string }[] = [];
const episodeUpdate = mock(async (_a: unknown) => undefined);
const notifySkipped = mock(async (_a: unknown) => undefined);

const deleteMany = mock(
  async ({
    where,
  }: {
    where: {
      targetKey?: string;
      id?: { in: number[] };
      createdAt?: { lt: Date };
    };
  }) => {
    rows = rows.filter((r) => {
      if (where.targetKey) return r.targetKey !== where.targetKey;
      if (where.id) return !where.id.in.includes(r.id);
      if (where.createdAt) return !(r.createdAt < where.createdAt.lt);
      return true;
    });
  },
);

mock.module("@rawkoon/api/db", () => ({
  prisma: {
    pendingRelease: {
      deleteMany,
      findMany: mock(
        async (a: {
          where: { targetKey?: string; grabAfter?: { lte: Date } };
          distinct?: string[];
        }) => {
          let out = rows;
          if (a.where.targetKey)
            out = out.filter((r) => r.targetKey === a.where.targetKey);
          if (a.where.grabAfter)
            out = out.filter((r) => r.grabAfter <= a.where.grabAfter!.lte);
          if (a.distinct) {
            const seen = new Set<string>();
            out = out.filter(
              (r) => !seen.has(r.targetKey) && seen.add(r.targetKey),
            );
          }
          return out;
        },
      ),
    },
    libraryEpisode: {
      findUnique: mock(async () => episode),
      findMany: mock(async () => []),
      update: episodeUpdate,
      count: mock(async () => 0),
    },
    grabBlocklist: { findMany: mock(async () => blocklisted) },
    libraryMedia: { findUnique: mock(async () => media) },
    qualityProfile: { findUnique: mock(async () => null) },
  },
}));

const grabRelease = mock(
  async (_o: { downloadUrl: string; grabSource?: string }) =>
    ({ grabbed: true, releaseTitle: "x" }) as
      | { grabbed: true; releaseTitle: string }
      | { grabbed: false; reason: string },
);
mock.module("@rawkoon/api/services/mediaGrabber/mediaGrabberGrab", () => ({
  grabRelease,
}));

mock.module("@rawkoon/api/workers/notifyLibraryGrabSkipped", () => ({
  notifyAdminsLibraryGrabSkipped: notifySkipped,
}));

const { processPendingReleases } = await import("./processPendingReleases");

const NOW = new Date("2026-01-01T12:00:00Z");
const row = (
  id: number,
  guid: string,
  score: number,
  grabAfterMin: number,
  source: string | null = null,
): Row => ({
  id,
  targetKey: "e:7",
  mediaId: 1,
  episodeId: 7,
  season: null,
  release: {
    guid,
    title: `Show.S01E01.${guid}`,
    magnetUrl: `magnet:?xt=${guid}`,
    downloadUrl: null,
    indexer: "idx",
    sizeBytes: 1e9,
    seeders: 5,
    freeleech: false,
  },
  score,
  source,
  grabAfter: new Date(NOW.getTime() + grabAfterMin * 60_000),
  createdAt: new Date(NOW.getTime() - 3600_000),
});

const wantedEpisode = {
  monitored: true,
  status: "wanted",
  media: { monitored: true },
  _count: { files: 0 },
};

beforeEach(() => {
  rows = [];
  episode = wantedEpisode;
  media = { qualityProfileId: null };
  grabRelease.mockClear();
  episodeUpdate.mockClear();
  notifySkipped.mockClear();
  blocklisted = [];
  grabRelease.mockImplementation(async () => ({
    grabbed: true,
    releaseTitle: "x",
  }));
});

describe("processPendingReleases", () => {
  it("leaves targets alone while their window is still open", async () => {
    rows = [row(1, "a", 1, 10)];
    const r = await processPendingReleases(NOW);
    expect(r).toEqual({ grabbed: 0, dropped: 0, reason: null });
    expect(grabRelease).not.toHaveBeenCalled();
    expect(rows).toHaveLength(1);
  });

  it("grabs the best candidate once the window elapsed, then clears the target", async () => {
    rows = [row(1, "low", 1, -5), row(2, "high", 9, 20)];
    const r = await processPendingReleases(NOW);
    expect(r.grabbed).toBe(1);
    expect(grabRelease).toHaveBeenCalledTimes(1);
    expect(grabRelease.mock.calls[0]![0].downloadUrl).toBe("magnet:?xt=high");
    expect(rows).toHaveLength(0);
  });

  it("falls through to the next candidate when a grab fails", async () => {
    rows = [row(1, "low", 1, -5), row(2, "high", 9, -5)];
    grabRelease.mockImplementationOnce(async () => ({
      grabbed: false,
      reason: "Blocklisted: bad",
      refusal: "blocklisted" as const,
    }));
    const r = await processPendingReleases(NOW);
    expect(grabRelease).toHaveBeenCalledTimes(2);
    expect(grabRelease.mock.calls[1]![0].downloadUrl).toBe("magnet:?xt=low");
    expect(r.grabbed).toBe(1);
    expect(rows).toHaveLength(0);
  });

  it("drops the target without grabbing when it is no longer wanted", async () => {
    rows = [row(1, "a", 1, -5)];
    episode = { ...wantedEpisode, status: "downloaded" };
    const r = await processPendingReleases(NOW);
    expect(r).toEqual({ grabbed: 0, dropped: 1, reason: "not_wanted" });
    expect(grabRelease).not.toHaveBeenCalled();
    expect(rows).toHaveLength(0);
  });

  it("drops a target that already has a file", async () => {
    rows = [row(1, "a", 1, -5)];
    episode = { ...wantedEpisode, _count: { files: 1 } };
    await processPendingReleases(NOW);
    expect(grabRelease).not.toHaveBeenCalled();
    expect(rows).toHaveLength(0);
  });

  it("grabs a held release that left the feed over a later, worse batch", async () => {
    // X1080 was held and is due; a poll then added Y720 to the same target.
    rows = [row(1, "x1080", 9, -5), row(2, "y720", 2, -1)];
    await processPendingReleases(NOW);
    expect(grabRelease).toHaveBeenCalledTimes(1);
    expect(grabRelease.mock.calls[0]![0].downloadUrl).toBe("magnet:?xt=x1080");
  });

  it("passes grabSource only for rows that came from RSS", async () => {
    rows = [row(1, "a", 1, -5, "rss")];
    await processPendingReleases(NOW);
    expect(grabRelease.mock.calls[0]![0].grabSource).toBe("rss");

    rows = [row(2, "b", 1, -5, null)];
    await processPendingReleases(NOW);
    expect(grabRelease.mock.calls[1]![0].grabSource).toBeUndefined();
  });

  it("skips blocklisted titles before replaying", async () => {
    rows = [row(1, "bad", 9, -5), row(2, "good", 1, -5)];
    blocklisted = [{ releaseTitle: "Show.S01E01.bad" }];
    await processPendingReleases(NOW);
    expect(grabRelease).toHaveBeenCalledTimes(1);
    expect(grabRelease.mock.calls[0]![0].downloadUrl).toBe("magnet:?xt=good");
  });

  it("counts a failed replay as a search attempt and drops the rows it tried", async () => {
    rows = [row(1, "a", 1, -5)];
    episode = { ...wantedEpisode };
    grabRelease.mockImplementation(async () => ({
      grabbed: false,
      reason: "client down",
    }));
    const r = await processPendingReleases(NOW);
    expect(r.grabbed).toBe(0);
    expect(episodeUpdate).toHaveBeenCalledTimes(1);
    expect(rows).toHaveLength(0);
  });

  it("keeps rows a poll added while the replay was running", async () => {
    rows = [row(1, "a", 1, -5)];
    grabRelease.mockImplementation(async () => {
      rows.push(row(2, "fresh", 5, 30));
      return { grabbed: false, reason: "client down" };
    });
    await processPendingReleases(NOW);
    expect(rows.map((r) => r.id)).toEqual([2]);
  });

  it("keeps the held set and counts no miss when the disk is too full", async () => {
    rows = [row(1, "a", 1, -5)];
    grabRelease.mockImplementation(async () => ({
      grabbed: false,
      reason: "Not enough free space: needs 1.0 GB, 0.5 GB free, keeping 10 GB",
      refusal: "no_space" as const,
    }));
    await processPendingReleases(NOW);
    expect(grabRelease.mock.calls[0]?.[0]).toMatchObject({ sizeBytes: 1e9 });
    expect(episodeUpdate).not.toHaveBeenCalled();
    expect(rows.map((r) => r.id)).toEqual([1]);
  });

  it("does not count a miss when another download already owns the target", async () => {
    rows = [row(1, "a", 1, -5)];
    grabRelease.mockImplementation(async () => ({
      grabbed: false,
      reason: "A download is already active for episode 7",
      refusal: "already_active" as const,
    }));
    await processPendingReleases(NOW);
    expect(episodeUpdate).not.toHaveBeenCalled();
    expect(rows).toHaveLength(0);
  });

  it("does not count a miss while a show-level pack carries the target", async () => {
    rows = [row(1, "a", 1, -5)];
    grabRelease.mockImplementation(async () => ({
      grabbed: false,
      reason: "A complete-series download is already active — cancel it",
      refusal: "show_grab_active" as const,
    }));
    await processPendingReleases(NOW);
    expect(episodeUpdate).not.toHaveBeenCalled();
    expect(rows).toHaveLength(0);
  });

  it("skips and notifies when failed replays reach the attempt cap", async () => {
    rows = [row(1, "a", 1, -5)];
    // The mocked findUnique serves both the wanted check and the miss lookup.
    episode = { ...wantedEpisode, id: 7, mediaId: 1, searchAttempts: 39 };
    grabRelease.mockImplementation(async () => ({
      grabbed: false,
      reason: "client down",
    }));
    await processPendingReleases(NOW);
    expect(episodeUpdate.mock.calls[0]![0]).toMatchObject({
      data: { searchAttempts: 40, status: "skipped" },
    });
    expect(notifySkipped).toHaveBeenCalledTimes(1);
  });

  it("grabs only the requested target when one is named", async () => {
    rows = [
      row(1, "a", 1, -5),
      { ...row(2, "b", 1, -5), targetKey: "e:8", episodeId: 8 },
    ];
    const r = await processPendingReleases(NOW, "e:8");
    expect(r.grabbed).toBe(1);
    expect(grabRelease).toHaveBeenCalledTimes(1);
    expect(grabRelease.mock.calls[0]![0].downloadUrl).toBe("magnet:?xt=b");
    expect(rows.map((x) => x.targetKey)).toEqual(["e:7"]);
  });

  it("expires rows older than a week", async () => {
    const stale = row(1, "a", 1, 600);
    stale.createdAt = new Date(NOW.getTime() - 8 * 86_400_000);
    rows = [stale];
    await processPendingReleases(NOW);
    expect(rows).toHaveLength(0);
  });
});
