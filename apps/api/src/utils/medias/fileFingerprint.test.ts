import { describe, expect, it } from "bun:test";
import { open, mkdtemp, rm, link, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  fileUnchanged,
  fingerprintDbFields,
  fingerprintFromStats,
  inodeKeyFromParts,
  mapPool,
  statFileFingerprint,
} from "./fileFingerprint";

describe("fileFingerprint", () => {
  it("fingerprintFromStats keeps size/mtime numeric and dev/ino textual", () => {
    const fp = fingerprintFromStats({
      size: 100n,
      mtimeMs: 1_700_000_000_123n,
      dev: 8n,
      ino: 42n,
    });
    expect(fp).toEqual({
      sizeBytes: 100n,
      mtimeMs: 1_700_000_000_123n,
      dev: "8",
      ino: "42",
    });
  });

  it("preserves an unsigned 64-bit inode exactly", () => {
    // mergerfs synthesizes inodes above 2^63. Anything that routes through a
    // JS number rounds this to 13255269450503841000.
    const fp = fingerprintFromStats({
      size: 100n,
      mtimeMs: 1n,
      dev: 39n,
      ino: 13255269450503840684n,
    });
    expect(fp.ino).toBe("13255269450503840684");
    expect(fp.dev).toBe("39");
  });

  it("fileUnchanged requires persisted mtime and matching size+mtime", () => {
    const live = fingerprintFromStats({
      size: 10n,
      mtimeMs: 100n,
      dev: 1n,
      ino: 2n,
    });
    expect(fileUnchanged({ sizeBytes: 10n, fileMtimeMs: null }, live)).toBe(
      false,
    );
    expect(fileUnchanged({ sizeBytes: 10n, fileMtimeMs: 100n }, live)).toBe(
      true,
    );
    expect(fileUnchanged({ sizeBytes: 11n, fileMtimeMs: 100n }, live)).toBe(
      false,
    );
    expect(fileUnchanged({ sizeBytes: 10n, fileMtimeMs: 99n }, live)).toBe(
      false,
    );
  });

  it("fingerprintDbFields maps to MediaFile columns", () => {
    expect(
      fingerprintDbFields({
        sizeBytes: 5n,
        mtimeMs: 9n,
        dev: "1",
        ino: "2",
      }),
    ).toEqual({
      sizeBytes: 5n,
      fileMtimeMs: 9n,
      fileDev: "1",
      fileIno: "2",
    });
  });

  it("inodeKeyFromParts stringifies consistently", () => {
    expect(inodeKeyFromParts(1, 2)).toBe("1:2");
    expect(inodeKeyFromParts(1n, 2n)).toBe("1:2");
  });

  it("statFileFingerprint reads a real file", async () => {
    const dir = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "fp-"));
    const path = join(dir, "a.bin");
    const fh = await open(path, "w");
    await fh.write(Buffer.alloc(32));
    await fh.close();
    try {
      const fp = await statFileFingerprint(path);
      expect(fp).not.toBeNull();
      expect(fp!.sizeBytes).toBe(32n);
      expect(fp!.mtimeMs > 0n).toBe(true);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("statFileFingerprint returns an inode matching the filesystem", async () => {
    const dir = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "fp-"));
    const path = join(dir, "a.mkv");
    const fh = await open(path, "w");
    await fh.write(Buffer.alloc(8));
    await fh.close();
    try {
      const fp = await statFileFingerprint(path);
      const st = await stat(path, { bigint: true });
      expect(fp!.ino).toBe(st.ino.toString());
      expect(fp!.dev).toBe(st.dev.toString());
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("gives a hardlink the same inode key and a copy a different one", async () => {
    const dir = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "fp-"));
    const a = join(dir, "a.mkv");
    const b = join(dir, "b.mkv");
    const c = join(dir, "c.mkv");
    const fh = await open(a, "w");
    await fh.write(Buffer.alloc(8));
    await fh.close();
    await link(a, b);
    const fhC = await open(c, "w");
    await fhC.write(Buffer.alloc(8));
    await fhC.close();
    try {
      const fpA = (await statFileFingerprint(a))!;
      const fpB = (await statFileFingerprint(b))!;
      const fpC = (await statFileFingerprint(c))!;
      expect(inodeKeyFromParts(fpB.dev, fpB.ino)).toBe(
        inodeKeyFromParts(fpA.dev, fpA.ino),
      );
      expect(inodeKeyFromParts(fpC.dev, fpC.ino)).not.toBe(
        inodeKeyFromParts(fpA.dev, fpA.ino),
      );
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("mapPool preserves order and bounds concurrency", async () => {
    let inflight = 0;
    let maxInflight = 0;
    const items = [1, 2, 3, 4, 5, 6];
    const out = await mapPool(items, 2, async (n) => {
      inflight++;
      maxInflight = Math.max(maxInflight, inflight);
      await Bun.sleep(5);
      inflight--;
      return n * 10;
    });
    expect(out).toEqual([10, 20, 30, 40, 50, 60]);
    expect(maxInflight).toBeLessThanOrEqual(2);
    expect(maxInflight).toBeGreaterThan(0);
  });
});
