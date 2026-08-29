import { describe, expect, test } from "bun:test";
import { probeAudioDuration } from "@rawkoon/api/services/books/probeAudioDuration";

const CHAPTER_ONE =
  "/mnt/storage/Audiobooks/Freida McFadden/L'intruse (2026)/01 - Chapter 1.mp3";

describe("probeAudioDuration", () => {
  test("reads the real duration of the reference book's first chapter", async () => {
    const seen = await probeAudioDuration(CHAPTER_ONE);
    expect(seen).toBeCloseTo(504.189388, 3);
  });

  test("returns null for a file that is not there", async () => {
    expect(await probeAudioDuration("/nope/missing.mp3")).toBeNull();
  });
});
