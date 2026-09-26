import { describe, expect, it } from "vitest";
import {
  derivedMbps,
  formatBytes,
  formatDuration,
  settingsKey,
  targetKbpsFromGb,
} from "@/features/transcode/format";

describe("transcode format helpers", () => {
  it("formats bytes in decimal units", () => {
    expect(formatBytes("1500000000")).toBe("1.5 GB");
    expect(formatBytes(1_234_000_000_000n)).toBe("1.23 TB");
    expect(formatBytes(900_000_000)).toBe("900 MB");
  });

  it("formats durations", () => {
    expect(formatDuration(59)).toBe("<1 min");
    expect(formatDuration(360)).toBe("6 min");
    expect(formatDuration(3 * 3600 + 20 * 60)).toBe("3 h 20 min");
  });

  it("derives a video bitrate from a per-file GB target", () => {
    // 2 files × 1.5 GB, 100 MB audio total, 2 h total → (3e9 − 1e8) × 8 / 7200 / 1000
    expect(targetKbpsFromGb(1.5, 2, 100_000_000, 7200)).toBe(3222);
    expect(targetKbpsFromGb(0.01, 1, 100_000_000, 3600)).toBe(100);
  });

  it("stable settings key and Mbps text", () => {
    const s = {
      codec: "hevc",
      encoder: "software",
      resolution: "keep",
      mode: "quality",
      preset: "balanced",
      speed: "default",
      convertLosslessAudio: false,
    } as const;
    expect(settingsKey(s)).toBe(settingsKey({ ...s }));
    expect(derivedMbps(3222)).toBe("3.2 Mbps");
  });
});
