import { beforeEach, describe, expect, it, mock } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let rows: { id: number; filePath: string }[] = [];
const del = mock(async (_a: unknown) => undefined);

mock.module("@rawkoon/api/db", () => ({
  prisma: { bookFile: { findMany: async () => rows, delete: del } },
}));

const { dropMissingRows, isUnchanged } = await import(
  "./postProcessorBookRescan"
);

beforeEach(() => del.mockClear());

describe("dropMissingRows", () => {
  it("drops a row whose file is gone", async () => {
    rows = [{ id: 1, filePath: "/nonexistent-dir/book.epub" }];
    const { removed } = await dropMissingRows(1);
    expect(removed).toBe(1);
    expect(del).toHaveBeenCalledTimes(1);
  });

  it("keeps a row when the file cannot be stat'ed for another reason", async () => {
    if (process.getuid?.() === 0) return; // root bypasses permission checks
    const dir = await mkdtemp(join(tmpdir(), "rescan-"));
    try {
      await writeFile(join(dir, "book.epub"), "x");
      await chmod(dir, 0o000);
      rows = [{ id: 2, filePath: join(dir, "book.epub") }];
      const { removed, survivors } = await dropMissingRows(1);
      expect(removed).toBe(0);
      expect(survivors.size).toBe(1);
      expect(del).not.toHaveBeenCalled();
    } finally {
      await chmod(dir, 0o700);
      await rm(dir, { recursive: true });
    }
  });
});

describe("isUnchanged", () => {
  const st = (ino: bigint) =>
    ({
      dev: 46n,
      ino,
      size: 10n,
      mtimeMs: 1000n,
    }) as import("node:fs").BigIntStats;
  const prior = (fileIno: string | null) => ({
    id: 1,
    filePath: "/lib/a.m4b",
    sizeBytes: 10n,
    fileDev: fileIno === null ? null : "46",
    fileIno,
    fileMtimeMs: 1000n,
  });

  it("matches on the exact inode", () => {
    expect(
      isUnchanged(prior("4611686018427400001"), st(4611686018427400001n)),
    ).toBe(true);
  });

  it("treats a rounded stored inode as changed, so the file is re-read once", () => {
    expect(
      isUnchanged(prior("4611686018427400000"), st(4611686018427400001n)),
    ).toBe(false);
  });

  it("falls back to size and mtime when the runtime reports no usable inode", () => {
    expect(isUnchanged(prior(null), st(0n))).toBe(true);
  });
});
