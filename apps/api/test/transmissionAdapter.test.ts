import { describe, expect, it } from "bun:test";
import { transmissionRowToNormalized } from "@rawkoon/api/services/downloadClient/transmissionAdapter";

describe("transmissionRowToNormalized", () => {
  it("maps a downloading torrent", () => {
    expect(
      transmissionRowToNormalized({
        hashString: "DEAD",
        name: "Show.S01E01",
        percentDone: 0.25,
        status: 4,
        rateDownload: 2048,
        peersConnected: 5,
        downloadDir: "/dl",
        sizeWhenDone: 100,
        error: 0,
        isStalled: false,
        labels: ["rawkoon-dh-123"],
        uploadRatio: 0.75,
      }),
    ).toEqual({
      hash: "dead",
      name: "Show.S01E01",
      state: "downloading",
      progress: 0.25,
      savePath: "/dl",
      contentPath: "/dl/Show.S01E01",
      seeds: 0,
      peers: 5,
      dlSpeed: 2048,
      sizeBytes: 100,
      labels: ["rawkoon-dh-123"],
      ratio: 0.75,
    });
  });

  it("maps a stalled torrent", () => {
    const result = transmissionRowToNormalized({
      hashString: "BEEF",
      name: "x",
      percentDone: 0.1,
      status: 4,
      rateDownload: 0,
      peersConnected: 0,
      downloadDir: "/dl",
      sizeWhenDone: 10,
      error: 0,
      isStalled: true,
    });

    expect(result.state).toBe("stalled");
  });
});
