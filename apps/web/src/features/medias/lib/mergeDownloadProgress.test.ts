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
    seeds: 3,
    peers: 2,
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
      seeds: 3,
      peers: 2,
    });
    // untouched row keeps its live
    expect(merged?.items[1].live).toBeNull();
  });

  it("keeps row-level size and quality through the merge", () => {
    const current: LibraryDownloadsResponse = {
      items: [
        row({
          id: 1,
          size_bytes: 2_000_000_000,
          quality_parsed: {
            resolution: 1080,
            source: "BluRay",
            codec: "x265",
            hdr: null,
          },
        }),
      ],
    };
    const merged = mergeDownloadProgress(current, [progress({ id: 1 })]);
    expect(merged?.items[0].size_bytes).toBe(2_000_000_000);
    expect(merged?.items[0].quality_parsed).toEqual({
      resolution: 1080,
      source: "BluRay",
      codec: "x265",
      hdr: null,
    });
  });

  it("keeps the snapshot seeds/peers when a push omits them", () => {
    const current: LibraryDownloadsResponse = {
      items: [
        row({
          id: 1,
          live: {
            progress: 0.1,
            download_speed: 10,
            eta_seconds: null,
            state: "downloading",
            seeds: 5,
            peers: 4,
          },
        }),
      ],
    };
    // An old-server payload without seeds/peers must not blank the snapshot.
    const pushed = {
      id: 1,
      progress: 0.7,
      state: "downloading",
      downloadSpeed: 20,
      etaSeconds: null,
    };
    const merged = mergeDownloadProgress(current, [pushed]);
    expect(merged?.items[0].live).toEqual({
      progress: 0.7,
      download_speed: 20,
      eta_seconds: null,
      state: "downloading",
      seeds: 5,
      peers: 4,
    });
  });

  it("replaces stale counts with zero or an explicit unknown value", () => {
    const current: LibraryDownloadsResponse = {
      items: [
        row({
          live: {
            progress: 0.1,
            download_speed: 10,
            eta_seconds: null,
            state: "downloading",
            seeds: 5,
            peers: 4,
          },
        }),
      ],
    };
    const merged = mergeDownloadProgress(current, [
      progress({ seeds: 0, peers: null }),
    ]);
    expect(merged?.items[0].live?.seeds).toBe(0);
    expect(merged?.items[0].live?.peers).toBeNull();
  });

  it("does not mutate the input", () => {
    const current: LibraryDownloadsResponse = { items: [row({ id: 1 })] };
    const merged = mergeDownloadProgress(current, [progress({ id: 1 })]);
    expect(merged).not.toBe(current);
    expect(current.items[0].live).toBeNull();
  });
});
