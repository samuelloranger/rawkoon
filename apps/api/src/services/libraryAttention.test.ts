import { describe, expect, it, beforeEach, mock } from "bun:test";
import { prismaMock, clearPrismaMocks } from "../../test/mocks/prisma";

mock.module("@rawkoon/api/db", () => ({ prisma: prismaMock }));

const importTypes = async () =>
  await import("@rawkoon/api/services/libraryAttentionTypes");
const importCandidatesSeason = async () =>
  await import("@rawkoon/api/services/libraryAttentionCandidatesSeason");
const importSync = async () =>
  await import("@rawkoon/api/services/libraryAttentionSync");

describe("attentionKindPriority", () => {
  it("ranks download_failed above auto_grab_stalled", async () => {
    const { attentionKindPriority } = await importTypes();
    expect(attentionKindPriority("download_failed")).toBeLessThan(
      attentionKindPriority("auto_grab_stalled"),
    );
  });
  it("ranks post_process_error above grab_skipped", async () => {
    const { attentionKindPriority } = await importTypes();
    expect(attentionKindPriority("post_process_error")).toBeLessThan(
      attentionKindPriority("grab_skipped"),
    );
  });
});

describe("inferSeasonFromReleaseTitle", () => {
  it("parses S02 from dotted release name", async () => {
    const { inferSeasonFromReleaseTitle } = await importCandidatesSeason();
    expect(inferSeasonFromReleaseTitle("Some.Show.S02E05.1080p")).toBe(2);
  });
  it("parses season word form", async () => {
    const { inferSeasonFromReleaseTitle } = await importCandidatesSeason();
    expect(inferSeasonFromReleaseTitle("Some Show Season 3 WEB")).toBe(3);
  });
  it("returns null when absent", async () => {
    const { inferSeasonFromReleaseTitle } = await importCandidatesSeason();
    expect(inferSeasonFromReleaseTitle("Movie.Name.2024.1080p")).toBeNull();
  });
});

describe("syncLibraryAttentionAlerts state machine", () => {
  beforeEach(() => {
    clearPrismaMocks();
  });

  it("creates a new alert when none exists for the candidate", async () => {
    prismaMock.libraryMedia.findMany.mockImplementationOnce(async () => [
      {
        id: 7,
        title: "Skipped Movie",
        type: "movie",
        searchAttempts: 3,
        status: "skipped",
      },
    ]);

    const { syncLibraryAttentionAlerts } = await importSync();
    const r = await syncLibraryAttentionAlerts();

    expect(prismaMock.libraryAttentionAlert.create).toHaveBeenCalledTimes(1);
    expect(r.created).toBe(1);
    expect(r.updated).toBe(0);
  });

  it("updates an existing open alert instead of creating a duplicate", async () => {
    // buildAttentionCandidates calls libraryMedia.findMany twice in parallel:
    // #1 for skippedMovies, #2 for stalledMovies
    prismaMock.libraryMedia.findMany
      .mockImplementationOnce(async () => [
        {
          id: 7,
          title: "Skipped Movie",
          type: "movie",
          searchAttempts: 3,
          status: "skipped",
        },
      ])
      // stalledMovies — none
      .mockImplementationOnce(async () => []);
    // Pre-fetched open alerts — alert 42 matches the candidate key
    prismaMock.libraryAttentionAlert.findMany.mockImplementationOnce(
      async () => [
        {
          id: 42,
          kind: "grab_skipped",
          scopeType: "movie",
          mediaId: 7,
          episodeId: null,
          season: null,
          downloadHistoryId: null,
        },
      ],
    );
    // buildValidationContext — media still skipped, so alert stays open
    prismaMock.libraryMedia.findMany.mockImplementationOnce(async () => [
      {
        id: 7,
        status: "skipped",
        type: "movie",
        monitored: true,
        searchAttempts: 3,
        _count: { files: 0 },
      },
    ]);

    const { syncLibraryAttentionAlerts } = await importSync();
    const r = await syncLibraryAttentionAlerts();

    expect(prismaMock.libraryAttentionAlert.create).not.toHaveBeenCalled();
    expect(prismaMock.libraryAttentionAlert.update).toHaveBeenCalledTimes(1);
    expect(r.created).toBe(0);
    expect(r.updated).toBe(1);
    expect(r.resolved).toBe(0);
  });

  it("auto-resolves an open alert whose underlying condition is no longer true", async () => {
    const openAlert = {
      id: 99,
      kind: "grab_skipped",
      scopeType: "movie",
      mediaId: 7,
      episodeId: null,
      season: null,
      downloadHistoryId: null,
    };
    // First findMany: initial existingOpenAlerts fetch
    prismaMock.libraryAttentionAlert.findMany.mockImplementationOnce(
      async () => [openAlert],
    );
    // Second findMany: re-fetch after upsert loop (currentOpenAlerts)
    prismaMock.libraryAttentionAlert.findMany.mockImplementationOnce(
      async () => [openAlert],
    );
    // buildValidationContext: media status is now "wanted" — not "skipped" → alert invalid

    const { syncLibraryAttentionAlerts } = await importSync();
    const r = await syncLibraryAttentionAlerts();

    expect(prismaMock.libraryAttentionAlert.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: [99] } },
        data: expect.objectContaining({ status: "resolved_auto" }),
      }),
    );
    expect(r.resolved).toBe(1);
  });

  it("skips show-level DH whose release title has no parseable season", async () => {
    prismaMock.downloadHistory.findMany.mockImplementationOnce(async () => [
      {
        id: 1,
        mediaId: 5,
        episodeId: null,
        releaseTitle: "Some Pack Without Season",
        grabbedAt: new Date(),
        failReason: "x",
        postProcessError: null,
        failed: true,
        completedAt: null,
        media: { id: 5, title: "Show", type: "show", status: "wanted" },
        episode: null,
      },
    ]);

    const { syncLibraryAttentionAlerts } = await importSync();
    const r = await syncLibraryAttentionAlerts();

    expect(prismaMock.libraryAttentionAlert.create).not.toHaveBeenCalled();
    expect(r.created).toBe(0);
  });

  it("includes capped (>= MAX_CRON_GRAB_ATTEMPTS) items as auto_grab_stalled", async () => {
    prismaMock.libraryMedia.findMany
      .mockImplementationOnce(async () => [])
      .mockImplementationOnce(async (args: unknown) => {
        const a = args as {
          where: { searchAttempts?: { gte?: number; lt?: number } };
        };
        const lt = a.where.searchAttempts?.lt;
        const gte = a.where.searchAttempts?.gte ?? 0;
        return [
          {
            id: 9,
            title: "Stuck Movie",
            type: "movie",
            searchAttempts: lt == null ? 30 : Math.min(30, lt - 1),
            status: "wanted",
          },
        ].filter((m) => m.searchAttempts >= gte);
      });

    const { syncLibraryAttentionAlerts } = await importSync();
    const r = await syncLibraryAttentionAlerts();

    expect(prismaMock.libraryAttentionAlert.create).toHaveBeenCalledTimes(1);
    const args = prismaMock.libraryAttentionAlert.create.mock.calls[0]?.[0] as {
      data: { kind: string; mediaId: number };
    };
    expect(args.data.kind).toBe("auto_grab_stalled");
    expect(args.data.mediaId).toBe(9);
    expect(r.created).toBe(1);
  });
});
