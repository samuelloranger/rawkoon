import { describe, expect, it } from "bun:test";
import { packRefusalPolicy } from "@rawkoon/api/services/postProcessorSeasonPack";

describe("packRefusalPolicy", () => {
  it("rejects the release (blocklist + clear) when its numbering or tracks are wrong", () => {
    expect(packRefusalPolicy("mismatch")).toEqual({
      rejectKind: "pack_mismatch",
      legacyBlocklist: false,
    });
  });
  it("keeps the torrent's data when the failure was tooling (MediaInfo, merge)", () => {
    expect(packRefusalPolicy("tooling")).toEqual({
      rejectKind: undefined,
      legacyBlocklist: true,
    });
  });
});
