import { describe, it, expect, beforeEach, afterAll } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { setupRescanBookHarness, type Row } from "./mocks/rescanBookHarness";

const {
  state,
  editionFixture,
  rescanBookEdition,
  ebookDir,
  audiobookDir,
  booksRoot,
  resetState,
  cleanup,
} = await setupRescanBookHarness();

afterAll(cleanup);

describe("rescanBookEdition", () => {
  beforeEach(resetState);

  // The scenario this function exists for: a book was removed (which keeps its
  // files) and re-added, leaving an edition with no rows and a file on disk.
  it("registers a file already in the library and marks the edition downloaded", async () => {
    await mkdir(ebookDir, { recursive: true });
    const file = join(ebookDir, "A Quiet Harbour (2019) [epub].epub");
    await writeFile(file, "x");

    const result = await rescanBookEdition(1);

    expect(result.registered).toBe(1);
    expect(result.refreshed).toBe(0);
    expect(result.directory).toBe(ebookDir);
    expect(state.created[0]?.filePath).toBe(file);
    expect(state.created[0]?.format).toBe("epub");
    expect(state.editionUpdates.map((u) => u.data)).toContainEqual({
      status: "downloaded",
    });
    expect(state.editionUpdates.map((u) => u.data)).toContainEqual({
      offlineReady: false,
    });
    expect(state.chapterDeleteCalls).toBe(1);
    // A newly adopted epub may name the same book's placeholder audiobook chapters.
    expect(state.renamed).toEqual([9]);
  });

  // Repeat scans used to report registered: 1 forever, because rows are
  // replaced by path. Nothing new was adopted, and the count must say so.
  it("reports a repeat scan as refreshed, not registered", async () => {
    await mkdir(ebookDir, { recursive: true });
    await writeFile(join(ebookDir, "A Quiet Harbour (2019) [epub].epub"), "x");

    await rescanBookEdition(1);
    const second = await rescanBookEdition(1);

    expect(second.registered).toBe(0);
    expect(second.refreshed).toBe(1);
    // Nothing new was adopted on the second scan, so the epub isn't re-read.
    expect(state.renamed).toEqual([9]);
    expect(state.files).toHaveLength(1);
    expect(state.chapterDeleteCalls).toBe(1);
  });

  it("drops rows whose file has disappeared and reverts the edition to wanted", async () => {
    state.files = [
      { id: 5, editionId: 1, filePath: join(ebookDir, "gone.epub") },
    ];

    const result = await rescanBookEdition(1);

    expect(result.removed).toBe(1);
    expect(state.deletedIds).toEqual([5]);
    expect(result.registered).toBe(0);
    expect(state.editionUpdates.at(-1)?.data.status).toBe("wanted");
    expect(state.editionUpdates.map((u) => u.data)).toContainEqual({
      offlineReady: false,
    });
    expect(state.chapterDeleteCalls).toBe(1);
  });

  // Only the templated directory is walked, so an unrelated book next door in
  // the library can never be adopted onto this edition.
  it("ignores files outside the edition's own directory", async () => {
    await mkdir(join(booksRoot, "Other Author", "Other Title (2020)"), {
      recursive: true,
    });
    await writeFile(
      join(booksRoot, "Other Author", "Other Title (2020)", "other.epub"),
      "x",
    );

    const result = await rescanBookEdition(1);

    expect(result.registered).toBe(0);
    expect(result.directory).toBeNull();
    expect(state.created).toEqual([]);
  });

  it("skips cover art and other junk that ships beside the book", async () => {
    await mkdir(ebookDir, { recursive: true });
    await writeFile(join(ebookDir, "A Quiet Harbour (2019) [epub].epub"), "x");
    await writeFile(join(ebookDir, "cover.jpg"), "x");
    await writeFile(join(ebookDir, "info.nfo"), "x");

    const result = await rescanBookEdition(1);

    expect(result.registered).toBe(1);
    expect(state.created).toHaveLength(1);
  });

  // Audio files under an ebook edition are somebody else's — a teaser track, a
  // bundled sample — and must not become rows on it.
  it("ignores audio files under an ebook edition", async () => {
    await mkdir(ebookDir, { recursive: true });
    await writeFile(join(ebookDir, "teaser.mp3"), "x");

    const result = await rescanBookEdition(1);

    expect(result.registered).toBe(0);
    expect(state.created).toEqual([]);
  });

  it("registers every track of an audiobook edition and reads its media info", async () => {
    state.edition = editionFixture({
      kind: "audiobook",
      bookQualityProfile: { allowedFormats: ["m4b", "mp3"] },
    });
    await mkdir(audiobookDir, { recursive: true });
    for (const name of ["01.mp3", "02.mp3", "03.mp3"]) {
      await writeFile(join(audiobookDir, name), "x");
    }

    const result = await rescanBookEdition(1);

    expect(result.registered).toBe(3);
    expect(result.directory).toBe(audiobookDir);
    expect(state.created[0]?.durationSecs).toBe(3600);
    expect(state.created[0]?.audioBitrate).toBe(64);
    // Tracks keep their own filenames.
    expect(state.created.map((c) => c.fileName).sort()).toEqual([
      "01.mp3",
      "02.mp3",
      "03.mp3",
    ]);
    // An audiobook adopted after its epub can still be named from it.
    expect(state.renamed).toEqual([9]);
  });

  // An audiobook rescan now also registers the chapter timeline, which is what
  // flips `offlineReady`. That path probes each track through ffprobe, so it is
  // covered by the registerBookChapters suite rather than mocked here —
  // `mock.module` is process-wide in bun and would break that suite.
  /**
   * The directory was created at import time from the metadata of the day. A
   * later refresh bumped publishedYear, so re-rendering the template names a
   * directory that never existed — and the rescan used to answer "no files
   * found in the library for this edition" about a file sitting right there.
   */
  it("finds files through the rows' own directory when metadata drifted since import", async () => {
    // On disk under (2019); the book now says 2024.
    await mkdir(ebookDir, { recursive: true });
    const file = join(ebookDir, "A Quiet Harbour (2019) [epub].epub");
    await writeFile(file, "x");
    state.edition = editionFixture({
      book: { ...editionFixture().book, publishedYear: 2024 },
    });
    state.files = [
      { id: 7, editionId: 1, filePath: file, fileName: basename(file) } as Row,
    ];

    const result = await rescanBookEdition(1);

    expect(result.directory).toBe(ebookDir);
    expect(result.refreshed).toBe(1);
    expect(state.deletedIds).toEqual([]);
  });

  // Uppercase extensions are real: the library holds both ".epub" and ".EPUB".
  it("adopts a file whose extension is uppercased", async () => {
    await mkdir(ebookDir, { recursive: true });
    await writeFile(join(ebookDir, "A Quiet Harbour (2019) [epub].EPUB"), "x");

    const result = await rescanBookEdition(1);

    expect(result.registered).toBe(1);
    expect(state.created[0]?.format).toBe("epub");
  });
});
