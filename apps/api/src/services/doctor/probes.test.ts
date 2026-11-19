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

const { linkedInodeKey } = await import(
  "@rawkoon/api/services/downloads/downloadsScanner"
);
const { normalizeInode } = await import(
  "@rawkoon/api/utils/medias/fileFingerprint"
);
const { scanDownloads } = await import("./probes");

afterAll(() => mock.restore());

const FAR = Date.now() + 60_000;

describe("library inode keys", () => {
  const real = 2n ** 63n + 12345n;

  it("matches a signed inode above 2^63 against its stored unsigned form", () => {
    // Bun reports such inodes as the negative two's-complement view.
    expect(linkedInodeKey({ nlink: 2n, ino: BigInt.asIntN(64, real) })).toBe(
      normalizeInode(real)!,
    );
  });

  it("ignores the device number, which a remount changes", () => {
    const before = linkedInodeKey({ nlink: 2n, ino: real });
    expect(linkedInodeKey({ nlink: 3n, ino: real })).toBe(before);
  });

  it("never matches a file with no other link", () => {
    expect(linkedInodeKey({ nlink: 1n, ino: real })).toBe("?");
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
