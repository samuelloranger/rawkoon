import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const base = await mkdtemp(join(tmpdir(), "clippipe-"));
Bun.env.IMAGE_STORAGE_DIR = join(base, "data", "images");
const root = join(base, "data", "clips");

type Row = Record<string, unknown> & { id: number };
let clip: Row;
let enabled = true;
let rowGone = false;
let source: {
  id: number;
  filePath: string;
  durationSecs: number | null;
} | null;
const updates: Record<string, unknown>[] = [];

mock.module("@rawkoon/api/db", () => ({
  prisma: {
    previewClip: {
      findUnique: async () => clip,
      updateMany: async ({ data }: { data: Record<string, unknown> }) => {
        if (rowGone) return { count: 0 };
        updates.push(data);
        Object.assign(clip, data);
        return { count: 1 };
      },
    },
    clipSettings: { findUnique: async () => ({ enabled }) },
    mediaSettings: { findUnique: async () => null },
    // The guard's tracked-file probe filters on filePath; the source lookup does not.
    mediaFile: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        "filePath" in where ? null : source,
    },
    $queryRaw: async () => [],
  },
}));

const { cutClip, pickStart, clampStart, sourceKeyFor } = await import(
  "@rawkoon/api/services/clips/clipPipeline"
);

afterAll(() => rm(base, { recursive: true, force: true }));

let calls: string[][];
const deps = (over: Partial<Parameters<typeof cutClip>[1]> = {}) => ({
  exec: async (args: string[]) => {
    calls.push(args);
    const out = args.at(-1) as string;
    if (args.includes("null"))
      return { code: 0, stderr: "crop=1920:800:0:140" };
    await writeFile(out, "mp4-bytes");
    return { code: 0, stderr: "" };
  },
  probeDuration: async () => 7200,
  vaapiDevice: async () => null,
  isHdr: async () => false,
  ...over,
});

beforeEach(async () => {
  await rm(root, { recursive: true, force: true });
  clip = {
    id: 5,
    kind: "movie",
    mediaId: 1,
    seasonNumber: 0,
    status: "queued",
    startSec: null,
  };
  enabled = true;
  rowGone = false;
  source = { id: 9, filePath: "/lib/movie.mkv", durationSecs: 7200 };
  updates.length = 0;
  calls = [];
});

describe("start points", () => {
  it("movies start at 25% and seasons at 10% of the source runtime", () => {
    expect(pickStart("movie", 7200)).toBe(1800);
    expect(pickStart("season", 2400)).toBe(240);
  });
  it("keeps the whole clip inside a short source", () => {
    expect(clampStart(50, 30)).toBe(18);
    expect(clampStart(5, 8)).toBe(0);
    expect(clampStart(-4, 100)).toBe(0);
  });
});

describe("cutClip", () => {
  it("publishes the clip under its id and records the outcome", async () => {
    await cutClip(5, deps());
    expect(await readFile(join(root, "clip-5.mp4"), "utf8")).toBe("mp4-bytes");
    expect(await readdir(root)).toEqual(["clip-5.mp4"]);
    expect(clip).toMatchObject({
      status: "done",
      startSec: 1800,
      bytes: 9,
      sourceMediaFileId: 9,
      sourceKey: sourceKeyFor("/lib/movie.mkv"),
    });
    const encode = calls.find((c) => !c.includes("null")) as string[];
    expect(encode).toContain("-n");
    expect(encode.join(" ")).toContain("crop=1920:800:0:140");
  });

  it("reuses a stored start instead of picking a new one", async () => {
    clip.startSec = 100;
    await cutClip(5, deps());
    expect(clip.startSec).toBe(100);
  });

  it("marks the clip failed and leaves no temp file when ffmpeg fails", async () => {
    await cutClip(
      5,
      deps({
        exec: async (args: string[]) => {
          if (!args.includes("null"))
            await writeFile(args.at(-1) as string, "partial");
          return { code: args.includes("null") ? 0 : 1, stderr: "boom" };
        },
      }),
    );
    expect(clip.status).toBe("failed");
    expect(String(clip.error)).toContain("ffmpeg exited 1");
    expect(await readdir(root)).toEqual([]);
  });

  it("does not throw when the row is deleted under a running job", async () => {
    rowGone = true;
    await expect(
      cutClip(5, deps({ exec: async () => ({ code: 1, stderr: "boom" }) })),
    ).resolves.toBeUndefined();
  });

  it("fails when the source file is gone", async () => {
    source = null;
    await cutClip(5, deps());
    expect(clip).toMatchObject({ status: "failed", error: "No source file" });
  });

  it("does nothing, and stays queued, while the feature is off", async () => {
    enabled = false;
    await cutClip(5, deps());
    expect(clip.status).toBe("queued");
    expect(calls).toHaveLength(0);
  });

  it("skips a clip that is already done", async () => {
    clip.status = "done";
    await cutClip(5, deps());
    expect(calls).toHaveLength(0);
  });

  it("fails without encoding when the safety guard refuses", async () => {
    Bun.env.IMAGE_STORAGE_DIR = "/images";
    await cutClip(5, deps());
    Bun.env.IMAGE_STORAGE_DIR = join(base, "data", "images");
    expect(clip.status).toBe("failed");
    expect(calls).toHaveLength(0);
  });
});
