import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import {
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const base = await mkdtemp(join(tmpdir(), "clipstore-"));
Bun.env.IMAGE_STORAGE_DIR = join(base, "data", "images");
const root = join(base, "data", "clips");

const store = await import("@rawkoon/api/services/clips/clipStore");

afterAll(() => rm(base, { recursive: true, force: true }));

beforeEach(async () => {
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });
});

describe("names", () => {
  it("derives the root from the image dir, next to it", () => {
    expect(store.clipsRoot()).toBe(root);
  });

  it("builds names only from positive safe integers", () => {
    expect(store.clipFileName(7)).toBe("clip-7.mp4");
    for (const bad of [
      "1/../x",
      "7",
      -1,
      0,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      2 ** 53,
    ]) {
      expect(() => store.clipFileName(bad as number)).toThrow();
    }
  });
});

describe("delete", () => {
  it("removes a plain clip file and reports its size", async () => {
    await writeFile(join(root, "clip-3.mp4"), "12345");
    expect(await store.deleteClip(3)).toBe(5);
    expect(await readdir(root)).toEqual([]);
  });

  it("is a no-op for a missing file", async () => {
    expect(await store.deleteClip(4)).toBe(0);
  });

  it("refuses a symlink and leaves its target alone", async () => {
    const target = join(base, "media.mkv");
    await writeFile(target, "media");
    await symlink(target, join(root, "clip-5.mp4"));
    await expect(store.deleteClip(5)).rejects.toThrow();
    expect(await readFile(target, "utf8")).toBe("media");
  });

  it("refuses a hardlinked file (nlink > 1)", async () => {
    const target = join(base, "linked.mkv");
    await writeFile(target, "media");
    await link(target, join(root, "clip-6.mp4"));
    await expect(store.deleteClip(6)).rejects.toThrow();
    expect(await readFile(target, "utf8")).toBe("media");
  });

  it("refuses a directory with a clip name", async () => {
    await mkdir(join(root, "clip-8.mp4"));
    await expect(store.deleteClip(8)).rejects.toThrow();
    expect((await stat(join(root, "clip-8.mp4"))).isDirectory()).toBe(true);
  });
});

describe("publish", () => {
  it("renames a temp file into place atomically and reports its size", async () => {
    const { name, path } = await store.reserveTempPath(11);
    expect(name).toMatch(/^clip-11\.tmp-\d+\.mp4$/);
    await writeFile(path, "video");
    await writeFile(join(root, "clip-11.mp4"), "old");
    expect(await store.publish(11, name)).toBe(5);
    expect(await readFile(join(root, "clip-11.mp4"), "utf8")).toBe("video");
    expect(await readdir(root)).toEqual(["clip-11.mp4"]);
  });

  it("rejects another clip's temp file and an empty output", async () => {
    const { name, path } = await store.reserveTempPath(12);
    await writeFile(path, "");
    await expect(store.publish(13, name)).rejects.toThrow();
    await expect(store.publish(12, name)).rejects.toThrow();
  });

  it("rejects names that are not clip temp files", async () => {
    await expect(store.publish(1, "../escape.tmp-1.mp4")).rejects.toThrow();
    await expect(store.publish(1, "clip-1.mp4")).rejects.toThrow();
  });
});

describe("delete all (poisoned directory)", () => {
  it("removes only pattern files; foreign files, nested dirs and symlink targets survive", async () => {
    const media = join(base, "library", "movie.mkv");
    await mkdir(join(base, "library"), { recursive: true });
    await writeFile(media, "precious");
    const inodeBefore = (await stat(media)).ino;

    await writeFile(join(root, "clip-1.mp4"), "aaa");
    await writeFile(join(root, "clip-2.tmp-99.mp4"), "bb");
    await writeFile(join(root, "notes.txt"), "foreign");
    await writeFile(join(root, "clip-1.mkv"), "foreign video");
    await mkdir(join(root, "nested"));
    await writeFile(join(root, "nested", "clip-4.mp4"), "nested clip");
    await mkdir(join(root, "clip-5.mp4")); // a directory wearing a clip name
    await symlink(media, join(root, "clip-6.mp4"));
    await link(media, join(root, "clip-7.mp4"));

    const result = await store.deleteAllClipFiles();

    expect(result).toEqual({ files: 2, bytes: 5 });
    expect((await readdir(root)).sort()).toEqual(
      [
        "clip-1.mkv",
        "clip-5.mp4",
        "clip-6.mp4",
        "clip-7.mp4",
        "nested",
        "notes.txt",
      ].sort(),
    );
    expect(await readFile(join(root, "nested", "clip-4.mp4"), "utf8")).toBe(
      "nested clip",
    );
    expect(await readFile(media, "utf8")).toBe("precious");
    expect((await stat(media)).ino).toBe(inodeBefore);
    expect((await lstat(join(root, "clip-6.mp4"))).isSymbolicLink()).toBe(true);
  });

  it("removes the root only when it ends up empty", async () => {
    await writeFile(join(root, "clip-1.mp4"), "a");
    await store.deleteAllClipFiles();
    await expect(stat(root)).rejects.toThrow();

    await mkdir(root);
    await writeFile(join(root, "keep.txt"), "x");
    await store.deleteAllClipFiles();
    expect((await stat(root)).isDirectory()).toBe(true);
  });

  it("does nothing when the folder does not exist", async () => {
    await rm(root, { recursive: true });
    expect(await store.deleteAllClipFiles()).toEqual({ files: 0, bytes: 0 });
  });
});

describe("orphan and stale sweeps", () => {
  it("deletes clip files whose id has no row, keeps known ones and foreign files", async () => {
    await writeFile(join(root, "clip-1.mp4"), "a");
    await writeFile(join(root, "clip-2.mp4"), "bb");
    await writeFile(join(root, "movie.mp4"), "foreign");
    const r = await store.sweepOrphans(async () => new Set([1]));
    expect(r).toEqual({ files: 1, bytes: 2 });
    expect((await readdir(root)).sort()).toEqual(["clip-1.mp4", "movie.mp4"]);
  });

  it("removes temp files older than the cutoff only", async () => {
    await writeFile(join(root, "clip-1.tmp-1.mp4"), "old");
    await writeFile(join(root, "clip-2.tmp-2.mp4"), "new");
    const old = new Date(Date.now() - 3 * 3600_000);
    await utimes(join(root, "clip-1.tmp-1.mp4"), old, old);
    expect(await store.sweepStaleTemps(3600_000)).toBe(1);
    expect(await readdir(root)).toEqual(["clip-2.tmp-2.mp4"]);
  });
});

describe("lock", () => {
  it("serializes work on one id", async () => {
    const order: string[] = [];
    const slow = store.withClipLock(20, async () => {
      order.push("a-start");
      await Bun.sleep(30);
      order.push("a-end");
    });
    const fast = store.withClipLock(20, async () => {
      order.push("b");
    });
    await Promise.all([slow, fast]);
    expect(order).toEqual(["a-start", "a-end", "b"]);
  });
});

describe("serving", () => {
  it("stats a plain clip and returns null when absent", async () => {
    await writeFile(join(root, "clip-30.mp4"), "abc");
    expect((await store.statClip(30))?.size).toBe(3);
    expect(await store.statClip(31)).toBeNull();
  });
});
