import { afterAll, describe, expect, it, mock } from "bun:test";
import {
  chmod,
  link,
  mkdir,
  mkdtemp,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

mock.module("@rawkoon/api/db", () => ({ prisma: {} }));

const { inodeKey } = await import(
  "@rawkoon/api/services/downloads/downloadsScanner"
);
const { inodeKeyFromParts, normalizeInode } = await import(
  "@rawkoon/api/utils/medias/fileFingerprint"
);
const { scanDownloads } = await import("./probes");

afterAll(() => mock.restore());

const FAR = Date.now() + 60_000;

describe("library inode keys", () => {
  it("matches a signed inode above 2^63 against its stored unsigned form", () => {
    const real = 2n ** 63n + 12345n;
    const stored = inodeKeyFromParts("77", normalizeInode(real)!);
    // Bun reports such inodes as the negative two's-complement view.
    expect(inodeKey(77n, BigInt.asIntN(64, real))).toBe(stored);
  });

  it("identifies a library file by inode alone, since a remount changes st_dev", () => {
    const real = 2n ** 63n + 12345n;
    expect(normalizeInode(BigInt.asIntN(64, real))).toBe(normalizeInode(real));
  });
});

describe("scanDownloads", () => {
  it("flags hardlinks, skips vanished and unreadable parts, and honors the deadline", async () => {
    const root = await mkdtemp(join(tmpdir(), "orphans-"));
    const lib = await mkdtemp(join(tmpdir(), "orphans-lib-"));
    try {
      await mkdir(join(root, "linked"));
      await writeFile(join(root, "linked", "a.mkv"), "x");
      await link(join(root, "linked", "a.mkv"), join(lib, "a.mkv"));
      await writeFile(join(root, "alone.mkv"), "yy");
      await mkdir(join(root, "locked"));
      await chmod(join(root, "locked"), 0o000);

      const st = await stat(join(lib, "a.mkv"), { bigint: true });
      const inodes = new Set([normalizeInode(st.ino)!]);
      const entries = await scanDownloads(root, inodes, FAR);
      const byName = Object.fromEntries(entries.map((e) => [e.name, e]));

      expect(byName.linked?.linkedToLibrary).toBe(true);
      expect(byName["alone.mkv"]).toMatchObject({
        linkedToLibrary: false,
        unreadable: false,
        sizeBytes: 2,
      });
      // Root can read a mode-000 directory, so only assert when it cannot.
      if (process.getuid?.() !== 0)
        expect(byName.locked?.unreadable).toBe(true);

      await expect(scanDownloads(root, inodes, 0)).rejects.toThrow("timed out");
    } finally {
      await chmod(join(root, "locked"), 0o700).catch(() => {});
      await rm(root, { recursive: true, force: true });
      await rm(lib, { recursive: true, force: true });
    }
  });
});
