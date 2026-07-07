import { describe, it, expect } from "vitest";
import {
  isDownloadInProgress,
  isPausedState,
} from "@/features/medias/hooks/downloadRowState";

const row = (
  over: Partial<{ completed_at: string | null; failed: boolean }>,
) => ({
  id: 1,
  release_title: "X",
  indexer: null,
  torrent_hash: "h1",
  grabbed_at: "2026-06-20T00:00:00Z",
  completed_at: null,
  failed: false,
  fail_reason: null,
  episode_id: null,
  ...over,
});

describe("downloadRowState", () => {
  it("in-progress = not completed and not failed", () => {
    expect(isDownloadInProgress(row({}))).toBe(true);
    expect(
      isDownloadInProgress(row({ completed_at: "2026-06-20T01:00:00Z" })),
    ).toBe(false);
    expect(isDownloadInProgress(row({ failed: true }))).toBe(false);
  });

  it("paused states cover qB 4.x (paused*) and 5.x (stopped*)", () => {
    expect(isPausedState("pausedDL")).toBe(true);
    expect(isPausedState("stoppedDL")).toBe(true);
    expect(isPausedState("downloading")).toBe(false);
    expect(isPausedState(null)).toBe(false);
  });
});
