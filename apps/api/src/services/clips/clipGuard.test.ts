import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const base = await mkdtemp(join(tmpdir(), "clipguard-"));
Bun.env.IMAGE_STORAGE_DIR = join(base, "data", "images");
const root = join(base, "data", "clips");
await mkdir(root, { recursive: true });

let settingsRow: Record<string, unknown> | null = null;
let fileHits: string[] = []; // startsWith prefixes that "match" a tracked file
let rawHit = false;
mock.module("@rawkoon/api/db", () => ({
  prisma: {
    mediaSettings: { findUnique: async () => settingsRow },
    mediaFile: {
      findFirst: async ({
        where,
      }: {
        where: { filePath: { startsWith: string } };
      }) =>
        fileHits.some((p) => where.filePath.startsWith.startsWith(p))
          ? { id: 1 }
          : null,
    },
    $queryRaw: async () => (rawHit ? [{ id: 1 }] : []),
  },
}));

const { assertClipsRootSafe, ClipSafetyError } = await import(
  "@rawkoon/api/services/clips/clipGuard"
);

afterAll(() => rm(base, { recursive: true, force: true }));
beforeEach(() => {
  settingsRow = { id: 1, moviesLibraryPath: join(base, "media", "movies") };
  fileHits = [];
  rawHit = false;
  for (const k of ["MEDIA_PATH_FROM", "MEDIA_PATH_TO", "MEDIA_PATH_REMAP"])
    delete Bun.env[k];
});

const refuses = () =>
  expect(assertClipsRootSafe()).rejects.toBeInstanceOf(ClipSafetyError);

describe("assertClipsRootSafe", () => {
  it("passes for a clips folder away from every media location", async () => {
    await mkdir(join(base, "media", "movies"), { recursive: true });
    await expect(assertClipsRootSafe()).resolves.toBeUndefined();
  });

  it("covers every media-settings column whose name contains Path", async () => {
    const schema = await readFile(
      join(import.meta.dir, "../../../prisma/schema.prisma"),
      "utf8",
    );
    const block =
      /model MediaSettings \{([\s\S]*?)\n\}/.exec(schema)?.[1] ?? "";
    const columns = [...block.matchAll(/^\s+(\w*Path\w*)\s/gm)].map(
      (m) => m[1] as string,
    );
    expect(columns.length).toBeGreaterThanOrEqual(5);
    for (const column of columns) {
      for (const overlap of [root, join(root, "sub"), join(base, "data")]) {
        settingsRow = { id: 1, [column]: overlap };
        await refuses();
      }
    }
  });

  it("refuses the filesystem root and top-level directories", async () => {
    Bun.env.IMAGE_STORAGE_DIR = "/images";
    await refuses();
    Bun.env.IMAGE_STORAGE_DIR = join(base, "data", "images");
  });

  it("refuses MEDIA_PATH env roots, including remap pairs", async () => {
    Bun.env.MEDIA_PATH_TO = join(base, "data");
    await refuses();
    delete Bun.env.MEDIA_PATH_TO;
    Bun.env.MEDIA_PATH_REMAP = `/x:${root}`;
    await refuses();
  });

  it("refuses the transcode temp dir and its ancestors", async () => {
    Bun.env.IMAGE_STORAGE_DIR = join(tmpdir(), "rawkoon-transcode", "images");
    await refuses();
    Bun.env.IMAGE_STORAGE_DIR = join(base, "data", "images");
  });

  it("sees through a symlinked library path (realpath and inode)", async () => {
    const link = join(base, "linked-library");
    await symlink(root, link);
    settingsRow = { id: 1, moviesLibraryPath: link };
    await refuses();
  });

  it("refuses when a tracked media file is inside the clips folder", async () => {
    fileHits = [`${root}/`];
    await refuses();
  });

  it("refuses when a tracked media file sits directly in a directory above", async () => {
    rawHit = true;
    await refuses();
  });
});
