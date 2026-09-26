import { describe, expect, it } from "bun:test";
import {
  enqueueBodySchema,
  jobSettingsSchema,
  moveBodySchema,
} from "@rawkoon/api/services/transcode/settingsSchema";

const base = {
  codec: "hevc",
  encoder: "software",
  resolution: "keep",
  mode: "quality",
  preset: "balanced",
  speed: "default",
  convertLosslessAudio: false,
};

describe("jobSettingsSchema", () => {
  it("accepts a quality-mode settings object", () => {
    expect(jobSettingsSchema.parse(base)).toEqual(base as never);
  });

  it("requires targetVideoKbps in target mode", () => {
    expect(() =>
      jobSettingsSchema.parse({ ...base, mode: "target" }),
    ).toThrow();
    expect(
      jobSettingsSchema.parse({
        ...base,
        mode: "target",
        targetVideoKbps: 3000,
      }).targetVideoKbps,
    ).toBe(3000);
  });

  it("rejects unknown codecs and resolutions", () => {
    expect(() => jobSettingsSchema.parse({ ...base, codec: "h264" })).toThrow();
    expect(() =>
      jobSettingsSchema.parse({ ...base, resolution: 480 }),
    ).toThrow();
  });
});

describe("enqueueBodySchema", () => {
  it("requires a non-empty selection", () => {
    expect(() =>
      enqueueBodySchema.parse({ selection: {}, settings: base }),
    ).toThrow();
    expect(
      enqueueBodySchema.parse({
        selection: { media_id: 3, season: 1 },
        settings: base,
      }).selection.season,
    ).toBe(1);
  });
});

describe("moveBodySchema", () => {
  it("accepts exactly one of top / before_id / after_id", () => {
    expect(moveBodySchema.parse({ top: true }).top).toBe(true);
    expect(() => moveBodySchema.parse({})).toThrow();
    expect(() => moveBodySchema.parse({ top: true, before_id: 2 })).toThrow();
  });
});
