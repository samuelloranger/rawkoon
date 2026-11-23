import { describe, expect, test } from "bun:test";
import {
  preferredLanguageIndex,
  scoreRelease,
} from "@rawkoon/api/utils/medias/releaseScorer";
import {
  baseProfile,
  isRejected,
  numScore,
  parsed,
} from "./releaseScorer.helpers";

const VOF = "Some.Show.S07.VOF.1080p.WEB.H265-GRP";
const VFF = "Some.Show.S07.VFF.1080p.WEB.H265-GRP";

describe("original French audio (VOF/VOQ)", () => {
  test("meets the first French preference, whichever variant it names", () => {
    expect(preferredLanguageIndex(VOF, ["VFI", "VFQ", "VFF", "fr"])).toBe(0);
    expect(preferredLanguageIndex(VFF, ["VFI", "VFQ", "VFF", "fr"])).toBe(2);
    expect(
      preferredLanguageIndex("Some.Film.2024.VOQ.1080p-GRP", ["en", "VFF"]),
    ).toBe(1);
  });

  test("passes a VFQ-only profile and outranks a France dub", () => {
    const profile = {
      ...baseProfile,
      preferredLanguages: ["VFI", "VFQ", "VFF", "VF2", "fr"],
    };
    const vof = scoreRelease(parsed(), profile, null, VOF);
    expect(numScore(vof)).toBeGreaterThan(
      numScore(scoreRelease(parsed(), profile, null, VFF)),
    );
    const vfqOnly = { ...baseProfile, preferredLanguages: ["VFQ"] };
    expect(isRejected(scoreRelease(parsed(), vfqOnly, null, VOF))).toBe(false);
  });

  test("does not satisfy a non-French profile", () => {
    const profile = { ...baseProfile, preferredLanguages: ["en"] };
    expect(isRejected(scoreRelease(parsed(), profile, null, VOF))).toBe(true);
  });
});
