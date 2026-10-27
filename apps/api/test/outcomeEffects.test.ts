import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";

// The production adapter picks the book or media failure notice by row target.
const calls: { name: string; args: unknown[] }[] = [];
const record =
  (name: string) =>
  async (...args: unknown[]) => {
    calls.push({ name, args });
  };

mock.module("@rawkoon/api/workers/notifyBookEvents", () => ({
  notifyAdminsBookImportFailed: record("bookImportFailed"),
  notifyAdminsBookDownloaded: record("bookDownloaded"),
}));
mock.module("@rawkoon/api/workers/notifyLibraryEvents", () => ({
  notifyAdminsPostProcessFailed: record("postProcessFailed"),
  notifyAdminsLibraryDownloadFailed: record("libraryDownloadFailed"),
}));

const { productionOutcomeEffects } = await import(
  "@rawkoon/api/services/downloads/outcomeEffects"
);

afterAll(() => {
  mock.restore();
});

beforeEach(() => {
  calls.length = 0;
});

describe("productionOutcomeEffects.importFailed", () => {
  it("sends the book notice for a book row", async () => {
    await productionOutcomeEffects.importFailed({
      downloadHistoryId: 1,
      reason: "bad file",
      mediaId: null,
      episodeId: null,
      bookEditionId: 9,
      isUpgrade: true,
    });
    expect(calls).toEqual([
      { name: "bookImportFailed", args: [9, "bad file", true] },
    ]);
  });

  it("sends the media notice for a media row", async () => {
    await productionOutcomeEffects.importFailed({
      downloadHistoryId: 1,
      reason: "bad file",
      mediaId: 4,
      episodeId: 7,
      bookEditionId: null,
      isUpgrade: false,
    });
    expect(calls).toEqual([
      { name: "postProcessFailed", args: [1, "bad file", 4, 7] },
    ]);
  });
});
