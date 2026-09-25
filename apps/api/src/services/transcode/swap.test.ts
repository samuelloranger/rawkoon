import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  nodeSwapFs,
  recoverSwap,
  type SwapFs,
  swapInPlace,
} from "@rawkoon/api/services/transcode/swap";
import { origPathFor } from "@rawkoon/api/services/transcode/outputPath";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "rawkoon-swap-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const exdevFs = (base: SwapFs, failFrom: string): SwapFs => ({
  ...base,
  rename: async (from, to) => {
    if (from === failFrom) {
      const e = new Error("cross-device") as NodeJS.ErrnoException;
      e.code = "EXDEV";
      throw e;
    }
    return base.rename(from, to);
  },
});
const ok = async () => true;

describe("swapInPlace", () => {
  it("renames tmp over the source", async () => {
    const src = join(dir, "a.mkv");
    const tmp = join(dir, ".a.rawkoon-tmp.mkv");
    await writeFile(src, "old");
    await writeFile(tmp, "new");
    await swapInPlace({
      tmp,
      source: src,
      final: src,
      fs: nodeSwapFs,
      verify: ok,
    });
    expect(await readFile(src, "utf8")).toBe("new");
    expect(await nodeSwapFs.exists(tmp)).toBe(false);
  });

  it("removes the old source when the final path differs", async () => {
    const src = join(dir, "a.mp4");
    const fin = join(dir, "a.mkv");
    const tmp = join(dir, ".a.rawkoon-tmp.mkv");
    await writeFile(src, "old");
    await writeFile(tmp, "new");
    await swapInPlace({
      tmp,
      source: src,
      final: fin,
      fs: nodeSwapFs,
      verify: ok,
    });
    expect(await readFile(fin, "utf8")).toBe("new");
    expect(await nodeSwapFs.exists(src)).toBe(false);
  });

  it("falls back to copy on EXDEV and cleans up", async () => {
    const src = join(dir, "a.mkv");
    const tmp = join(dir, ".a.rawkoon-tmp.mkv");
    await writeFile(src, "old");
    await writeFile(tmp, "new");
    await swapInPlace({
      tmp,
      source: src,
      final: src,
      fs: exdevFs(nodeSwapFs, tmp),
      verify: ok,
    });
    expect(await readFile(src, "utf8")).toBe("new");
    expect(await nodeSwapFs.exists(origPathFor(src))).toBe(false);
    expect(await nodeSwapFs.exists(tmp)).toBe(false);
  });

  it("restores the original when the copied file fails verification", async () => {
    const src = join(dir, "a.mkv");
    const tmp = join(dir, ".a.rawkoon-tmp.mkv");
    await writeFile(src, "old");
    await writeFile(tmp, "new");
    await expect(
      swapInPlace({
        tmp,
        source: src,
        final: src,
        fs: exdevFs(nodeSwapFs, tmp),
        verify: async () => false,
      }),
    ).rejects.toThrow("verification");
    expect(await readFile(src, "utf8")).toBe("old");
    expect(await nodeSwapFs.exists(origPathFor(src))).toBe(false);
  });
});

describe("recoverSwap", () => {
  it("returns none when there is no orig", async () => {
    const src = join(dir, "a.mkv");
    await writeFile(src, "x");
    expect(
      await recoverSwap({
        source: src,
        final: src,
        fs: nodeSwapFs,
        verify: ok,
      }),
    ).toBe("none");
  });

  it("recoverSwap restores orig when final is invalid", async () => {
    const src = join(dir, "a.mkv");
    await writeFile(origPathFor(src), "old");
    await writeFile(src, "half-copied");
    const r = await recoverSwap({
      source: src,
      final: src,
      fs: nodeSwapFs,
      verify: async () => false,
    });
    expect(r).toBe("restored-orig");
    expect(await readFile(src, "utf8")).toBe("old");
  });

  it("keeps a valid final and deletes orig", async () => {
    const src = join(dir, "a.mkv");
    await writeFile(origPathFor(src), "old");
    await writeFile(src, "new");
    const r = await recoverSwap({
      source: src,
      final: src,
      fs: nodeSwapFs,
      verify: ok,
    });
    expect(r).toBe("kept-final");
    expect(await readFile(src, "utf8")).toBe("new");
    expect(await nodeSwapFs.exists(origPathFor(src))).toBe(false);
  });
});
