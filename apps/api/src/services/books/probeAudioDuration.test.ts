import { describe, expect, test } from "bun:test";
import { probeAudioDuration } from "@rawkoon/api/services/books/probeAudioDuration";

const CHAPTER_ONE =
  "/mnt/storage/Audiobooks/Freida McFadden/L'intruse (2026)/01 - Chapter 1.mp3";
const NON_AUDIO_FILE =
  "/mnt/storage/Audiobooks/Freida McFadden/L'intruse (2026)/cover.png";
const BOOK_DIRECTORY =
  "/mnt/storage/Audiobooks/Freida McFadden/L'intruse (2026)";

describe("probeAudioDuration", () => {
  test("reads the real duration of the reference book's first chapter", async () => {
    const seen = await probeAudioDuration(CHAPTER_ONE);
    expect(seen).toBeCloseTo(504.189388, 3);
  });

  test("returns null for a file that is not there", async () => {
    expect(await probeAudioDuration("/nope/missing.mp3")).toBeNull();
  });

  test("returns null for a non-audio file", async () => {
    expect(await probeAudioDuration(NON_AUDIO_FILE)).toBeNull();
  });

  test("returns null for a directory", async () => {
    expect(await probeAudioDuration(BOOK_DIRECTORY)).toBeNull();
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
