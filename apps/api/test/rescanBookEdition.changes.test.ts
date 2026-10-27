import { describe, it, expect, beforeEach, afterAll } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setupRescanBookHarness, type Row } from "./mocks/rescanBookHarness";

const {
  state,
  editionFixture,
  rescanBookEdition,
  audiobookDir,
  audiobooksRoot,
  resetState,
  cleanup,
} = await setupRescanBookHarness();

afterAll(cleanup);

describe("rescanBookEdition", () => {
  beforeEach(resetState);

  /**
   * A chapter replaced or re-encoded in place keeps its row, so it is neither
   * registered nor removed — but its duration moved, and every cumulative
   * offset after it in the timeline is now wrong. Leaving offlineReady true
   * would serve a manifest whose seeks land in the wrong place.
   */
  it("invalidates the chapter timeline when an existing file's bytes changed", async () => {
    const { stat } = await import("node:fs/promises");
    state.edition = editionFixture({
      kind: "audiobook",
      offlineReady: true,
      bookQualityProfile: { allowedFormats: ["mp3"] },
    });
    await mkdir(audiobookDir, { recursive: true });
    const track = join(audiobookDir, "01.mp3");
    await writeFile(track, "x");
    const st = await stat(track);
    state.files = [
      {
        id: 42,
        editionId: 1,
        filePath: track,
        fileName: "01.mp3",
        // A size that disagrees with disk is the "changed in place" signal.
        sizeBytes: BigInt(st.size + 1024),
        fileDev: String(st.dev),
        fileIno: String(st.ino),
        fileMtimeMs: BigInt(Math.trunc(st.mtimeMs)),
      } as unknown as Row,
    ];

    await rescanBookEdition(1);

    expect(state.chapterDeleteCalls).toBeGreaterThan(0);
    expect(
      state.editionUpdates.some((u) => u.data.offlineReady === false),
    ).toBe(true);
  });

  // Clients verify downloads against this hash, so a stale one fails every
  // download of a file that was rewritten in place.
  it("re-hashes a file whose bytes changed in place", async () => {
    const { stat } = await import("node:fs/promises");
    const { createHash } = await import("node:crypto");
    state.edition = editionFixture({
      kind: "audiobook",
      offlineReady: true,
      bookQualityProfile: { allowedFormats: ["mp3"] },
    });
    await mkdir(audiobookDir, { recursive: true });
    const track = join(audiobookDir, "01.mp3");
    await writeFile(track, "rewritten");
    const st = await stat(track);
    state.files = [
      {
        id: 42,
        editionId: 1,
        filePath: track,
        fileName: "01.mp3",
        sizeBytes: BigInt(st.size + 1024),
        sha256: "stale",
        fileDev: String(st.dev),
        fileIno: String(st.ino),
        fileMtimeMs: BigInt(Math.trunc(st.mtimeMs)),
      } as unknown as Row,
    ];

    await rescanBookEdition(1);

    const expected = createHash("sha256").update("rewritten").digest("hex");
    expect(state.fileUpdates.some((u) => u.sha256 === expected)).toBe(true);
  });

  // The unchanged-file fast path must not drag the timeline down with it.
  it("leaves the chapter timeline alone when nothing changed", async () => {
    const { stat } = await import("node:fs/promises");
    state.edition = editionFixture({
      kind: "audiobook",
      offlineReady: true,
      bookQualityProfile: { allowedFormats: ["mp3"] },
    });
    await mkdir(audiobookDir, { recursive: true });
    const track = join(audiobookDir, "01.mp3");
    await writeFile(track, "x");
    const st = await stat(track);
    state.files = [
      {
        id: 42,
        editionId: 1,
        filePath: track,
        fileName: "01.mp3",
        sizeBytes: BigInt(st.size),
        fileDev: String(st.dev),
        fileIno: String(st.ino),
        fileMtimeMs: BigInt(Math.trunc(st.mtimeMs)),
      } as unknown as Row,
    ];

    await rescanBookEdition(1);

    expect(state.chapterDeleteCalls).toBe(0);
  });

  // The expensive part of a rescan is the per-file probe. An unchanged file
  // keeps its row untouched rather than paying for it again.
  it("skips re-probing a file whose size, inode and mtime are unchanged", async () => {
    const { stat } = await import("node:fs/promises");
    state.edition = editionFixture({
      kind: "audiobook",
      offlineReady: true,
      bookQualityProfile: { allowedFormats: ["mp3"] },
    });
    await mkdir(audiobookDir, { recursive: true });
    const track = join(audiobookDir, "01.mp3");
    await writeFile(track, "x");
    const st = await stat(track);
    state.files = [
      {
        id: 42,
        editionId: 1,
        filePath: track,
        fileName: "01.mp3",
        sizeBytes: BigInt(st.size),
        fileDev: String(st.dev),
        fileIno: String(st.ino),
        fileMtimeMs: BigInt(Math.trunc(st.mtimeMs)),
      } as unknown as Row,
    ];

    const result = await rescanBookEdition(1);

    expect(result.refreshed).toBe(1);
    expect(result.registered).toBe(0);
    // No upsert ran, so nothing was re-probed.
    expect(state.created).toEqual([]);
  });

  it("reports an error instead of guessing when no library path is set", async () => {
    const realDb = await import("@rawkoon/api/db");
    const settings = realDb.prisma.mediaSettings as unknown as {
      upsert: () => Promise<unknown>;
    };
    const original = settings.upsert;
    settings.upsert = () =>
      Promise.resolve({
        booksLibraryPath: null,
        audiobooksLibraryPath: audiobooksRoot,
        bookTemplate: "{author}/{title}",
        audiobookTemplate: "{author}/{title}",
      });

    const result = await rescanBookEdition(1);
    settings.upsert = original;

    expect(result.error).toBe("No ebook library path configured");
    expect(result.registered).toBe(0);
  });

  it("reports an error when the edition does not exist", async () => {
    state.edition = null;

    const result = await rescanBookEdition(1);

    expect(result.error).toBe("Edition not found");
  });
});
