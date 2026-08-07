import { describe, expect, it } from "bun:test";
import { open, mkdtemp, rm } from "node:fs/promises";
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
  it("fingerprintFromStats normalizes number and bigint fields", () => {
    const fp = fingerprintFromStats({
      size: 100,
      mtimeMs: 1_700_000_000_123.7,
      dev: 8,
      ino: 42,
    });
    expect(fp).toEqual({
      sizeBytes: 100n,
      mtimeMs: 1_700_000_000_123n,
      dev: 8n,
      ino: 42n,
    });

    const big = fingerprintFromStats({
      size: 99n,
      mtimeMs: 5,
      dev: 1n,
      ino: 2n,
    });
    expect(big.sizeBytes).toBe(99n);
    expect(big.dev).toBe(1n);
    expect(big.ino).toBe(2n);
  });

  it("fileUnchanged requires persisted mtime and matching size+mtime", () => {
    const live = fingerprintFromStats({
      size: 10,
      mtimeMs: 100,
      dev: 1,
      ino: 2,
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
        dev: 1n,
        ino: 2n,
      }),
    ).toEqual({
      sizeBytes: 5n,
      fileMtimeMs: 9n,
      fileDev: 1n,
      fileIno: 2n,
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
