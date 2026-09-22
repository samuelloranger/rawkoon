import { afterAll, describe, expect, it } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isFullyReadable } from "@rawkoon/api/services/postProcessorHelpers";

const base = await mkdtemp(join(tmpdir(), "rawkoon-readable-"));
const isRoot = process.getuid?.() === 0;

afterAll(async () => {
  await chmod(join(base, "locked", "inner"), 0o755).catch(() => {});
  await rm(base, { recursive: true, force: true });
});

describe("isFullyReadable", () => {
  it("is false for a missing content root (unmounted pool, wrong mapping)", async () => {
    expect(await isFullyReadable(join(base, "does-not-exist"))).toBe(false);
  });

  it("is true for a readable tree, even one with no video in it", async () => {
    await mkdir(join(base, "ok", "sub"), { recursive: true });
    await writeFile(join(base, "ok", "sub", "readme.txt"), "x");
    expect(await isFullyReadable(join(base, "ok"))).toBe(true);
  });

  it("is true for a single readable file", async () => {
    await writeFile(join(base, "single.bin"), "x");
    expect(await isFullyReadable(join(base, "single.bin"))).toBe(true);
  });

  it.skipIf(isRoot)(
    "is false when any directory in the tree is unreadable",
    async () => {
      await mkdir(join(base, "locked", "inner"), { recursive: true });
      await chmod(join(base, "locked", "inner"), 0o000);
      expect(await isFullyReadable(join(base, "locked"))).toBe(false);
    },
  );
});
