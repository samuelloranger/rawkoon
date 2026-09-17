import { describe, expect, it } from "vitest";
import type {
  DownloadProgressItem,
  LibraryDownloadHistoryItem,
  LibraryDownloadsResponse,
} from "@rawkoon/shared/types";
import { mergeDownloadProgress } from "./mergeDownloadProgress";

function row(
  over: Partial<LibraryDownloadHistoryItem>,
): LibraryDownloadHistoryItem {
  return {
    id: 1,
    release_title: "release",
    indexer: null,
    torrent_hash: "abc",
    grabbed_at: "2026-01-01T00:00:00Z",
    completed_at: null,
    failed: false,
    fail_reason: null,
    episode_id: null,
    live: null,
    ...over,
  };
}

function progress(over: Partial<DownloadProgressItem>): DownloadProgressItem {
  return {
    id: 1,
    progress: 0.5,
    state: "downloading",
    downloadSpeed: 1000,
    etaSeconds: null,
    ...over,
  };
}

describe("mergeDownloadProgress", () => {
  it("returns current unchanged when there is no data or no progress", () => {
    expect(mergeDownloadProgress(undefined, [progress({})])).toBeUndefined();
    const current: LibraryDownloadsResponse = { items: [row({})] };
    expect(mergeDownloadProgress(current, [])).toBe(current);
  });

  it("overlays pushed progress onto the matching row, snake-cased", () => {
    const current: LibraryDownloadsResponse = {
      items: [row({ id: 1 }), row({ id: 2 })],
    };
    const merged = mergeDownloadProgress(current, [
      progress({ id: 1, progress: 0.8, downloadSpeed: 2048, state: "stalled" }),
    ]);
    expect(merged?.items[0].live).toEqual({
      progress: 0.8,
      download_speed: 2048,
      eta_seconds: null,
      state: "stalled",
    });
    // untouched row keeps its live
    expect(merged?.items[1].live).toBeNull();
  });

  it("does not mutate the input", () => {
    const current: LibraryDownloadsResponse = { items: [row({ id: 1 })] };
    const merged = mergeDownloadProgress(current, [progress({ id: 1 })]);
    expect(merged).not.toBe(current);
    expect(current.items[0].live).toBeNull();
  });
});
