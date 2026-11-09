import { beforeEach, describe, expect, it, mock } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let rows: { id: number; filePath: string }[] = [];
const del = mock(async (_a: unknown) => undefined);

mock.module("@rawkoon/api/db", () => ({
  prisma: { bookFile: { findMany: async () => rows, delete: del } },
}));

const { dropMissingRows } = await import("./postProcessorBookRescan");

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
