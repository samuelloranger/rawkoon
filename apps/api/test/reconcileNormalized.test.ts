import { describe, expect, it } from "bun:test";
import type { NormalizedTorrent } from "@rawkoon/api/services/downloadClient/types";
import {
  classifyPendingAgainstTorrent,
  computeNextPollDelaySecs,
  findPendingTorrent,
} from "@rawkoon/api/workers/checkDownloadCompletion";

const base: NormalizedTorrent = {
  hash: "h",
  name: "n",
  state: "downloading",
  progress: 0.5,
  savePath: "/dl",
  contentPath: "/dl/n",
  seeds: 1,
  peers: 1,
  dlSpeed: 1,
  sizeBytes: 10,
  labels: [],
  ratio: null,
};
const now = 1_000_000;
const settings = { stallTimeoutSecs: 100, maxAgeSecs: 1000 };

describe("classifyPendingAgainstTorrent", () => {
  it("completes terminal state or full progress", () => {
    expect(
      classifyPendingAgainstTorrent(
        { ...base, state: "completed" },
        { createdAtMs: now, lastProgress: 0.5, lastProgressAtMs: now },
        now,
        settings,
      ).outcome,
    ).toBe("complete");
    expect(
      classifyPendingAgainstTorrent(
        { ...base, progress: 1 },
        { createdAtMs: now, lastProgress: 1, lastProgressAtMs: now },
        now,
        settings,
      ).outcome,
    ).toBe("complete");
  });

  it("fails error, stall-timeout, and max-age states", () => {
    expect(
      classifyPendingAgainstTorrent(
        { ...base, state: "error" },
        { createdAtMs: now, lastProgress: 0.5, lastProgressAtMs: now },
        now,
        settings,
      ),
    ).toEqual({
      outcome: "fail",
      reason: "download client reported error state",
    });
    expect(
      classifyPendingAgainstTorrent(
        { ...base, state: "stalled" },
        {
          createdAtMs: now - 500_000,
          lastProgress: 0.5,
          lastProgressAtMs: now - 200_000,
        },
        now,
        settings,
      ).outcome,
    ).toBe("fail");
    expect(
      classifyPendingAgainstTorrent(
        { ...base, progress: 0.9 },
        {
          createdAtMs: now - 2_000_000,
          lastProgress: 0.9,
          lastProgressAtMs: now - 10_000,
        },
        now,
        settings,
      ).outcome,
    ).toBe("fail");
  });

  it("tracks real progress and times out a non-progressing download", () => {
    expect(
      classifyPendingAgainstTorrent(
        { ...base, progress: 0.7 },
        {
          createdAtMs: now,
          lastProgress: 0.5,
          lastProgressAtMs: now - 50_000,
        },
        now,
        settings,
      ),
    ).toEqual({ outcome: "wait", progressed: true });
    expect(
      classifyPendingAgainstTorrent(
        base,
        {
          createdAtMs: now - 500_000,
          lastProgress: 0.5,
          lastProgressAtMs: now - 200_000,
        },
        now,
        settings,
      ).outcome,
    ).toBe("fail");
  });
});

describe("findPendingTorrent", () => {
  it("matches by hash first, then by download-history label", () => {
    const labeled = { ...base, hash: "other", labels: ["rawkoon-dh-42"] };
    expect(findPendingTorrent([base, labeled], 42, "H")).toEqual(base);
    expect(findPendingTorrent([labeled], 42, null)).toEqual(labeled);
  });
});

describe("computeNextPollDelaySecs", () => {
  it("uses the active tier while a torrent is live in the client", () => {
    expect(computeNextPollDelaySecs(true, 20, 1800)).toBe(20);
    expect(computeNextPollDelaySecs(true, 20, 1800, 5)).toBe(20);
  });

  it("ramps to idle over several quiet passes instead of jumping", () => {
    expect(computeNextPollDelaySecs(false, 20, 1800, 0)).toBe(20);
    expect(computeNextPollDelaySecs(false, 20, 1800, 1)).toBe(60);
    expect(computeNextPollDelaySecs(false, 20, 1800, 2)).toBe(300);
    expect(computeNextPollDelaySecs(false, 20, 1800, 3)).toBe(1800);
  });

  it("never ramps past the configured idle interval", () => {
    expect(computeNextPollDelaySecs(false, 20, 30, 2)).toBe(30);
  });
});
