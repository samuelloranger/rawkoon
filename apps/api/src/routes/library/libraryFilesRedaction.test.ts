import { describe, expect, it, mock } from "bun:test";

let isAdmin = false;
const now = new Date("2026-01-01T00:00:00Z");

mock.module("@rawkoon/api/middleware/hono/auth", () => ({
  requireUser: async (
    c: { set: (key: string, value: unknown) => void },
    next: () => Promise<void>,
  ) => {
    c.set("user", { id: "u1", is_admin: isAdmin });
    await next();
  },
  ensureAdmin: () => null,
}));
mock.module("@rawkoon/api/db", () => ({
  prisma: {
    libraryMedia: { findUnique: async () => ({ id: 1, type: "movie" }) },
    downloadHistory: {
      findMany: async () => [
        {
          id: 1,
          releaseTitle: "Some.Release.1080p",
          indexer: "tracker",
          torrentHash: null,
          grabbedAt: now,
          completedAt: now,
          failed: true,
          failReason: "boom",
          episodeId: null,
          postProcessError: "bad",
          postProcessDestinationPath: "/lib/x",
          aiPicked: false,
          seedReleasedAt: now,
          seedReleasedBytes: null,
          qualityParsed: null,
        },
      ],
    },
    mediaFile: {
      findMany: async () => [
        {
          id: 1,
          fileName: "a.mkv",
          filePath: "/lib/a.mkv",
          sizeBytes: 1n,
          scannedAt: now,
          audioTracks: [],
          subtitleTracks: [],
          episode: null,
        },
      ],
    },
  },
}));

const { libraryFilesRoutes } = await import("./libraryFilesRoutes");

describe("library files/downloads redaction", () => {
  it("redacts operator detail for non-admins", async () => {
    isAdmin = false;
    const d = (await (
      await libraryFilesRoutes.request("/1/downloads")
    ).json()) as any;
    expect(d.items[0].release_title).toBe("");
    expect(d.items[0].indexer).toBeNull();
    expect(d.items[0].fail_reason).toBeNull();
    const f = (await (
      await libraryFilesRoutes.request("/1/files")
    ).json()) as any;
    expect(f.files[0].file_path).toBe("");
    expect(f.files[0].file_name).toBe("a.mkv");
  });

  it("returns full rows for admins", async () => {
    isAdmin = true;
    const d = (await (
      await libraryFilesRoutes.request("/1/downloads")
    ).json()) as any;
    expect(d.items[0].release_title).toBe("Some.Release.1080p");
    expect(d.items[0].indexer).toBe("tracker");
    expect(d.items[0].fail_reason).toBe("boom");
    const f = (await (
      await libraryFilesRoutes.request("/1/files")
    ).json()) as any;
    expect(f.files[0].file_path).toBe("/lib/a.mkv");
  });
});
