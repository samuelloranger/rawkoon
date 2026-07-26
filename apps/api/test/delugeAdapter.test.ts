import { describe, expect, it } from "bun:test";
import { delugeRowToNormalized } from "@rawkoon/api/services/downloadClient/delugeAdapter";

describe("delugeRowToNormalized", () => {
  it("maps a seeding torrent and scales progress to 0..1", () => {
    expect(
      delugeRowToNormalized("abcd", {
        name: "Movie",
        progress: 100,
        state: "Seeding",
        download_payload_rate: 0,
        num_seeds: 4,
        num_peers: 1,
        save_path: "/dl",
        total_wanted: 500,
        label: "rawkoon-dh-123",
        ratio: 2,
      }),
    ).toEqual({
      hash: "abcd",
      name: "Movie",
      state: "completed",
      progress: 1,
      savePath: "/dl",
      contentPath: "/dl/Movie",
      seeds: 4,
      peers: 1,
      dlSpeed: 0,
      sizeBytes: 500,
      labels: ["rawkoon-dh-123"],
      ratio: 2,
    });
  });
});
