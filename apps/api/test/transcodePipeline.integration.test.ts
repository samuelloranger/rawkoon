import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TranscodeJobSettings } from "@rawkoon/shared/types";
import { detectCapabilities } from "@rawkoon/api/services/transcode/capabilities";
import { runFfmpeg } from "@rawkoon/api/services/transcode/ffmpegRunner";
import {
  type PipelineDeps,
  runPipeline,
} from "@rawkoon/api/services/transcode/pipeline";
import { probeFile } from "@rawkoon/api/services/transcode/probe";
import { nodeSwapFs } from "@rawkoon/api/services/transcode/swap";
import { statFileFingerprint } from "@rawkoon/api/utils/medias/fileFingerprint";

const hasFfmpeg = Bun.which("ffmpeg") != null && Bun.which("ffprobe") != null;
const d = hasFfmpeg ? describe : describe.skip;

let dir: string;
let src: string;
const settings: TranscodeJobSettings = {
  codec: "hevc",
  encoder: "software",
  resolution: "keep",
  mode: "quality",
  preset: "small",
  speed: "faster",
  convertLosslessAudio: false,
};

async function makeSource(path: string) {
  await writeFile(
    join(dir, "s.srt"),
    "1\n00:00:01,000 --> 00:00:02,000\nhello\n",
  );
  const p = Bun.spawn([
    "ffmpeg",
    "-nostdin",
    "-y",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=s=640x360:r=24:d=40",
    "-f",
    "lavfi",
    "-i",
    "sine=f=440:d=40",
    "-f",
    "lavfi",
    "-i",
    "sine=f=880:d=40",
    "-i",
    join(dir, "s.srt"),
    "-map",
    "0",
    "-map",
    "1",
    "-map",
    "2",
    "-map",
    "3",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-qp",
    "0",
    "-c:a",
    "aac",
    "-c:s",
    "srt",
    "-metadata:s:a:0",
    "language=fre",
    "-metadata:s:a:1",
    "language=eng",
    "-metadata:s:s:0",
    "language=fre",
    path,
  ]);
  expect(await p.exited).toBe(0);
}

function deps(rescanned: string[]): PipelineDeps {
  return {
    mapPath: (p) => p,
    probe: probeFile,
    run: runFfmpeg,
    fingerprint: statFileFingerprint,
    nlink: async (p) => Number((await stat(p)).nlink),
    freeBytes: async () => 10n ** 12n,
    fs: nodeSwapFs,
    capabilities: () => detectCapabilities(),
    rescan: async (p) => {
      rescanned.push(p);
    },
  };
}

async function jobFor(path: string) {
  const fp = (await statFileFingerprint(path))!;
  return {
    id: 1,
    settings,
    estimatedBytes: null,
    source: {
      dbPath: path,
      sizeBytes: fp.sizeBytes,
      fileMtimeMs: fp.mtimeMs,
      fileDev: fp.dev,
      fileIno: fp.ino,
    },
  };
}
const hooks = { onStep: () => {}, onProgress: () => {} };

d("transcode pipeline (real ffmpeg)", () => {
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "rawkoon-tc-"));
    src = join(dir, "Clip [360p].mkv");
    await makeSource(src);
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("fails validation with an impossible threshold and leaves the source byte-identical", async () => {
    const before = await readFile(src);
    const r = await runPipeline(await jobFor(src), deps([]), hooks, {
      signal: new AbortController().signal,
      threads: 2,
      thresholds: { avg: 1.01, min: 0.5 },
    });
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toContain("Quality check");
    expect((await readFile(src)).equals(before)).toBe(true);
  }, 120_000);

  it("re-encodes, validates, replaces and rescans", async () => {
    const rescanned: string[] = [];
    const r = await runPipeline(await jobFor(src), deps(rescanned), hooks, {
      signal: new AbortController().signal,
      threads: 2,
      thresholds: { avg: 0.9, min: 0.8 },
    });
    expect(r).toMatchObject({ ok: true, finalDbPath: src });
    const out = await probeFile(src);
    expect(out.video?.codec).toBe("hevc");
    expect(
      out.streams.filter((s) => s.type === "audio").map((s) => s.language),
    ).toEqual(["fre", "eng"]);
    expect(out.streams.filter((s) => s.type === "subtitle")).toHaveLength(1);
    expect(rescanned).toEqual([src]);
  }, 180_000);

  it("cancel mid-encode removes the temp file", async () => {
    const other = join(dir, "Other.mkv");
    await makeSource(other);
    const ac = new AbortController();
    const p = runPipeline(
      await jobFor(other),
      deps([]),
      {
        onStep: (s) => {
          if (s === "encode") setTimeout(() => ac.abort(), 300);
        },
        onProgress: () => {},
      },
      {
        signal: ac.signal,
        threads: 1,
        thresholds: { avg: 0.9, min: 0.8 },
      },
    );
    const r = await p;
    expect(r).toMatchObject({ ok: false, cancelled: true });
    expect(await nodeSwapFs.exists(join(dir, ".Other.rawkoon-tmp.mkv"))).toBe(
      false,
    );
  }, 120_000);
});
