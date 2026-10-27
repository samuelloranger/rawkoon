import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { probeAudioDuration } from "@rawkoon/api/services/books/probeAudioDuration";

const hasFfmpeg = Bun.which("ffmpeg") != null && Bun.which("ffprobe") != null;

let dir = "";
let chapter = "";
let nonAudio = "";

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "probe-audio-"));
  chapter = join(dir, "01 - Chapter 1.mp3");
  nonAudio = join(dir, "cover.png");
  // A real 1x1 PNG: ffprobe reads plain text as a "tty" stream with a duration.
  await writeFile(
    nonAudio,
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
      "base64",
    ),
  );
  if (hasFfmpeg) {
    const proc = Bun.spawn(
      [
        "ffmpeg",
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "anullsrc=r=22050:cl=mono",
        "-t",
        "3",
        "-q:a",
        "9",
        chapter,
      ],
      { stdout: "ignore", stderr: "ignore" },
    );
    if ((await proc.exited) !== 0) throw new Error("ffmpeg fixture failed");
  }
});

afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe("probeAudioDuration", () => {
  test.if(hasFfmpeg)("reads the duration of a real mp3", async () => {
    // MP3 frame padding makes the probed length a few hundredths over the encode length.
    expect(await probeAudioDuration(chapter)).toBeCloseTo(3, 0);
  });

  test("returns null for a file that is not there", async () => {
    expect(await probeAudioDuration("/nope/missing.mp3")).toBeNull();
  });

  test("returns null for a non-audio file", async () => {
    expect(await probeAudioDuration(nonAudio)).toBeNull();
  });

  test("returns null for a directory", async () => {
    expect(await probeAudioDuration(dir)).toBeNull();
  });

  test("never throws and resolves null for hostile inputs", async () => {
    const hostileInputs = [
      "",
      "/tmp/path-with-a-newline\nin-it.mp3",
      `/tmp/${"x".repeat(3_000_000)}.mp3`,
    ];
    for (const input of hostileInputs) {
      await expect(probeAudioDuration(input)).resolves.toBeNull();
    }
  });
});
