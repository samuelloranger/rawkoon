import { describe, expect, it } from "bun:test";
import { open, mkdtemp, rm, link } from "node:fs/promises";
import { join } from "node:path";
import {
  fileUnchanged,
  fingerprintDbFields,
  fingerprintFromStats,
  inodeKeyFromParts,
  mapPool,
  normalizeInode,
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

  describe("normalizeInode", () => {
    it("passes ordinary inodes through", () => {
      expect(normalizeInode(42n)).toBe("42");
      expect(normalizeInode(652474865603395072n)).toBe("652474865603395072");
    });

    it("reinterprets a wrapped negative inode as unsigned", () => {
      // Bun 1.3.14 returns the signed two's-complement view of a mergerfs
      // inode. These pairs were measured against `stat -c %i` on the pool.
      expect(normalizeInode(-4420810779339849877n)).toBe(
        "14025933294369701739",
      );
      expect(normalizeInode(-723977626834603555n)).toBe("17722766446874948061");
    });

    it("rejects the saturation sentinel", () => {
      // Bun 1.3.11 clamps every inode above 2^63 to INT64_MAX, so the value
      // is the same constant for every file on the pool. Persisting it would
      // make every file collide on one identity key.
      expect(normalizeInode(9223372036854775807n)).toBeNull();
    });

    it("rejects a zero inode", () => {
      expect(normalizeInode(0n)).toBeNull();
    });
  });

  it("leaves dev/ino unset when the inode is untrustworthy", () => {
    const fp = fingerprintFromStats({
      size: 100n,
      mtimeMs: 1n,
      dev: 39n,
      ino: 9223372036854775807n,
    });
    expect(fp.ino).toBeNull();
    expect(fp.dev).toBeNull();
    expect(fingerprintDbFields(fp)).toEqual({
      sizeBytes: 100n,
      fileMtimeMs: 1n,
      fileDev: null,
      fileIno: null,
    });
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

  it("statFileFingerprint agrees with the filesystem, not just with itself", async () => {
    // Deliberately compared against coreutils rather than another Bun stat.
    // A Bun-to-Bun assertion passes even when Bun is reporting the wrong
    // inode, which is exactly how a saturating runtime slipped through.
    const dir = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "fp-"));
    const path = join(dir, "a.mkv");
    const fh = await open(path, "w");
    await fh.write(Buffer.alloc(8));
    await fh.close();
    try {
      const fp = await statFileFingerprint(path);
      const truth = (
        await new Response(
          Bun.spawn(["stat", "-c", "%d %i", path], { stderr: "ignore" }).stdout,
        ).text()
      ).trim();
      expect(`${fp!.dev} ${fp!.ino}`).toBe(truth);
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
      const key = (fp: { dev: string | null; ino: string | null }) => {
        expect(fp.dev).not.toBeNull();
        expect(fp.ino).not.toBeNull();
        return inodeKeyFromParts(fp.dev as string, fp.ino as string);
      };
      const fpA = (await statFileFingerprint(a))!;
      const fpB = (await statFileFingerprint(b))!;
      const fpC = (await statFileFingerprint(c))!;
      expect(key(fpB)).toBe(key(fpA));
      expect(key(fpC)).not.toBe(key(fpA));
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
