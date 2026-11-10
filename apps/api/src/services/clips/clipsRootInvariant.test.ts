import { describe, expect, it } from "bun:test";
import { Glob } from "bun";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

// Rule 1: clip code outside clipStore never mutates the filesystem.
const MUTATORS =
  /\b(unlink|unlinkSync|rm|rmSync|rmdir|rmdirSync|rename|renameSync|writeFile|writeFileSync|appendFile|truncate|copyFile|symlink|link|Bun\.write)\s*\(/;

const apiSrc = join(import.meta.dir, "..", "..");
const GLOBS = [
  "services/clips/*.ts",
  "routes/clips/*.ts",
  "workers/generateClip.ts",
];

describe("clip code never mutates files outside clipStore", () => {
  it("finds no mutating fs call", async () => {
    const offenders: string[] = [];
    let scanned = 0;
    for (const pattern of GLOBS) {
      for await (const rel of new Glob(pattern).scan({ cwd: apiSrc })) {
        if (rel.endsWith(".test.ts") || rel.endsWith("clipStore.ts")) continue;
        scanned++;
        const lines = (await readFile(join(apiSrc, rel), "utf8")).split("\n");
        lines.forEach((line, i) => {
          if (MUTATORS.test(line))
            offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
        });
      }
    }
    expect(scanned).toBeGreaterThan(4);
    expect(offenders).toEqual([]);
  });

  it("keeps the other mutating calls out of the transcode swap helpers", async () => {
    for await (const rel of new Glob("services/clips/*.ts").scan({
      cwd: apiSrc,
    })) {
      if (rel.endsWith(".test.ts")) continue;
      const src = await readFile(join(apiSrc, rel), "utf8");
      expect(src).not.toMatch(
        /transcode\/(swap|buildArgs|outputPath)|pruneEmptyParentDirs|storageService/,
      );
    }
  });
});
