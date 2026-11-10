import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const base = await mkdtemp(join(tmpdir(), "clipsvc-"));
Bun.env.IMAGE_STORAGE_DIR = join(base, "data", "images");
const root = join(base, "data", "clips");

type Clip = {
  id: number;
  kind: string;
  mediaId: number;
  seasonNumber: number;
  status: string;
  sourceMediaFileId: number | null;
  sourceKey: string | null;
  updatedAt: Date;
};
let enabled = true;
let clips: Clip[] = [];
let nextId = 1;
// Library state, as the two reconcile queries see it.
let movieFiles: { id: number; mediaId: number; filePath: string }[] = [];
let seasonFiles: {
  id: number;
  filePath: string;
  episode: { mediaId: number; season: number; episode: number };
}[] = [];
const queued: number[] = [];

mock.module("@rawkoon/api/services/queueService", () => ({
  clipsQueue: {
    add: async (_n: string, d: { clipId: number }) =>
      void queued.push(d.clipId),
    pause: async () => {},
    resume: async () => {},
  },
}));
mock.module("@rawkoon/api/db", () => ({
  prisma: {
    clipSettings: {
      upsert: async () => ({ enabled, paused: false }),
      findUnique: async () => ({ enabled, paused: false }),
    },
    mediaSettings: { findUnique: async () => null },
    $queryRaw: async () => [],
    mediaFile: {
      findFirst: async () => null,
      findMany: async ({ where }: { where: Record<string, any> }) => {
        if (where.id) {
          const ids: number[] = where.id.in;
          return [...movieFiles, ...seasonFiles].filter((f) =>
            ids.includes(f.id),
          );
        }
        return where.episodeId === null ? movieFiles : seasonFiles;
      },
    },
    previewClip: {
      findMany: async ({
        where,
        select,
      }: {
        where?: Record<string, any>;
        select?: unknown;
      } = {}) => {
        const rows = where?.status
          ? clips.filter((c) => c.status === where.status)
          : clips;
        return select ? rows.map((c) => ({ id: c.id })) : rows;
      },
      createMany: async ({
        data,
      }: {
        data: Omit<Clip, "id" | "status" | "updatedAt">[];
      }) => {
        for (const d of data) {
          clips.push({
            ...d,
            id: nextId++,
            status: "queued",
            updatedAt: new Date(),
          });
        }
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: number };
        data: Partial<Clip>;
      }) => Object.assign(clips.find((c) => c.id === where.id) as Clip, data),
      updateMany: async () => ({ count: 0 }),
      deleteMany: async ({ where }: { where?: { id: number } } = {}) => {
        clips = where ? clips.filter((c) => c.id !== where.id) : [];
      },
    },
  },
}));

const svc = await import("@rawkoon/api/services/clips/clipService");
const { sourceKeyFor } = await import(
  "@rawkoon/api/services/clips/clipPipeline"
);

afterAll(() => rm(base, { recursive: true, force: true }));

const done = (over: Partial<Clip>): Clip => ({
  id: nextId++,
  kind: "movie",
  mediaId: 1,
  seasonNumber: 0,
  status: "done",
  sourceMediaFileId: 1,
  sourceKey: sourceKeyFor("/lib/a.mkv"),
  updatedAt: new Date(),
  ...over,
});

beforeEach(async () => {
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });
  enabled = true;
  clips = [];
  nextId = 1;
  movieFiles = [];
  seasonFiles = [];
  queued.length = 0;
});

describe("reconcileClips", () => {
  it("does nothing while disabled", async () => {
    enabled = false;
    movieFiles = [{ id: 1, mediaId: 1, filePath: "/lib/a.mkv" }];
    await svc.reconcileClips();
    expect(clips).toEqual([]);
  });

  it("queues a movie and each regular season once, using the lowest episode's file", async () => {
    movieFiles = [
      { id: 1, mediaId: 1, filePath: "/lib/a.mkv" },
      { id: 2, mediaId: 1, filePath: "/lib/a-extra.mkv" },
    ];
    seasonFiles = [
      {
        id: 10,
        filePath: "/s/e01.mkv",
        episode: { mediaId: 2, season: 1, episode: 1 },
      },
      {
        id: 11,
        filePath: "/s/e02.mkv",
        episode: { mediaId: 2, season: 1, episode: 2 },
      },
      {
        id: 12,
        filePath: "/s/s2e01.mkv",
        episode: { mediaId: 2, season: 2, episode: 1 },
      },
    ];
    await svc.reconcileClips();
    expect(
      clips.map((c) => [
        c.kind,
        c.mediaId,
        c.seasonNumber,
        c.sourceMediaFileId,
      ]),
    ).toEqual([
      ["movie", 1, 0, 1],
      ["season", 2, 1, 10],
      ["season", 2, 2, 12],
    ]);
    expect(queued).toEqual(clips.map((c) => c.id));
  });

  it("leaves a done clip alone when its source row is unchanged", async () => {
    movieFiles = [{ id: 1, mediaId: 1, filePath: "/lib/a.mkv" }];
    clips = [done({})];
    await svc.reconcileClips();
    expect(clips[0]?.status).toBe("done");
  });

  it("requeues when the source row is gone or its path changed (upgrade)", async () => {
    movieFiles = [{ id: 2, mediaId: 1, filePath: "/lib/a.2160p.mkv" }];
    clips = [done({ sourceMediaFileId: 1 })];
    await svc.reconcileClips();
    expect(clips[0]?.status).toBe("queued");

    clips = [
      done({ sourceMediaFileId: 2, sourceKey: sourceKeyFor("/lib/a.mkv") }),
    ];
    await svc.reconcileClips();
    expect(clips[0]?.status).toBe("queued");
  });

  it("deletes the file and row of a title that left the library, and orphan files with no row", async () => {
    movieFiles = [{ id: 1, mediaId: 1, filePath: "/lib/a.mkv" }];
    clips = [done({ id: 50, mediaId: 99 }), done({ id: 51, mediaId: 1 })];
    await writeFile(join(root, "clip-50.mp4"), "x");
    await writeFile(join(root, "clip-51.mp4"), "y");
    await writeFile(join(root, "clip-77.mp4"), "orphan");
    await writeFile(join(root, "other.mp4"), "foreign");
    await svc.reconcileClips();
    expect(clips.map((c) => c.id)).toEqual([51]);
    expect((await readdir(root)).sort()).toEqual(["clip-51.mp4", "other.mp4"]);
  });
});

describe("deleteAllClips", () => {
  it("is refused while clips are enabled", async () => {
    expect(await svc.deleteAllClips()).toEqual({
      ok: false,
      reason: "enabled",
    });
  });

  it("removes files and rows when disabled and reports the freed bytes", async () => {
    enabled = false;
    clips = [done({ id: 60 })];
    await writeFile(join(root, "clip-60.mp4"), "abcd");
    expect(await svc.deleteAllClips()).toEqual({
      ok: true,
      files: 1,
      bytes: 4,
    });
    expect(clips).toEqual([]);
  });
});
