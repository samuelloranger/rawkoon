import { describe, expect, it } from "vitest";
import type { TranscodeJob } from "@rawkoon/shared/types";
import { settingsLabel } from "./transcodeTabHelpers";

const job = (id: number, batch_id: string, settings: object = {}) =>
  ({
    id,
    batch_id,
    settings: {
      codec: "hevc",
      encoder: "software",
      resolution: "keep",
      mode: "quality",
      preset: "balanced",
      convertLosslessAudio: false,
      ...settings,
    },
  }) as unknown as TranscodeJob;

describe("settingsLabel", () => {
  it("describes a CPU quality job", () => {
    expect(settingsLabel(job(1, "a"))).toBe("HEVC · CPU · balanced");
  });

  it("describes a GPU target job with downscale and audio conversion", () => {
    const j = job(1, "a", {
      encoder: "vaapi",
      resolution: "1080",
      mode: "target",
      targetVideoKbps: 4500,
      convertLosslessAudio: true,
    });
    expect(settingsLabel(j)).toBe("HEVC · GPU · →1080p · 4.5 Mbps · EAC3");
  });
});
