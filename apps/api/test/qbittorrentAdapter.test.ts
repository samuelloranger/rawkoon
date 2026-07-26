import { describe, expect, it } from "bun:test";
import { qbRawToNormalized } from "@rawkoon/api/services/downloadClient/qbittorrentAdapter";

describe("qbRawToNormalized", () => {
  it("maps a qBittorrent maindata torrent row", () => {
    expect(
      qbRawToNormalized("abc123", {
        name: "Movie.2024.1080p",
        state: "stalledDL",
        progress: 0.5,
        save_path: "/downloads",
        content_path: "/downloads/Movie.2024.1080p",
        num_seeds: 2,
        num_leechs: 1,
        dlspeed: 1000,
        size: 42,
      }),
    ).toEqual({
      hash: "abc123",
      name: "Movie.2024.1080p",
      state: "stalled",
      progress: 0.5,
      savePath: "/downloads",
      contentPath: "/downloads/Movie.2024.1080p",
      seeds: 2,
      peers: 1,
      dlSpeed: 1000,
      sizeBytes: 42,
    });
  });
});
