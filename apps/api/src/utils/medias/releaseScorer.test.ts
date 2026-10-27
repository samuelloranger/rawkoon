import { describe, expect, test } from "bun:test";
import {
  scoreRelease,
  scoreReleaseDetailed,
} from "@rawkoon/api/utils/medias/releaseScorer";
import {
  baseProfile,
  isRejected,
  numScore,
  parsed,
} from "./releaseScorer.helpers";

describe("scoreRelease — hard rejections", () => {
  test("rejects below min resolution", () => {
    const r = scoreRelease(parsed({ resolution: 720 }), baseProfile, null);
    expect(isRejected(r)).toBe(true);
    expect(r).toEqual(["resolution_below_min"]);
  });

  test("rejects null resolution", () => {
    const r = scoreRelease(parsed({ resolution: null }), baseProfile, null);
    expect(isRejected(r)).toBe(true);
    expect(r).toEqual(["resolution_below_min"]);
  });

  test("rejects sample", () => {
    const r = scoreRelease(parsed({ isSample: true }), baseProfile, null);
    expect(isRejected(r)).toBe(true);
    expect(r).toEqual(["is_sample"]);
  });

  test("rejects when requireHdr and no hdr", () => {
    const r = scoreRelease(
      parsed({ hdr: null }),
      { ...baseProfile, requireHdr: true },
      null,
    );
    expect(isRejected(r)).toBe(true);
    expect(r).toEqual(["hdr_required_absent"]);
  });

  test("rejects over max size", () => {
    const r = scoreRelease(parsed(), { ...baseProfile, maxSizeGb: 5 }, 6e9);
    expect(isRejected(r)).toBe(true);
    expect(r).toEqual(["size_over_cap"]);
  });

  test("rejects above cutoff resolution", () => {
    const r = scoreRelease(
      parsed({ resolution: 2160 }),
      { ...baseProfile, cutoffResolution: 1080 },
      null,
    );
    expect(isRejected(r)).toBe(true);
    expect(r).toEqual(["resolution_above_cutoff"]);
  });
});

describe("scoreRelease — resolution tier bonus", () => {
  test("4K scores higher than 1080p with same profile", () => {
    const s1080 = numScore(
      scoreRelease(parsed({ resolution: 1080 }), baseProfile, null),
    );
    const s4k = numScore(
      scoreRelease(parsed({ resolution: 2160 }), baseProfile, null),
    );
    expect(s4k).toBeGreaterThan(s1080);
  });

  test("cutoff at 1080 rejects 2160 but accepts 1080", () => {
    const capped = { ...baseProfile, cutoffResolution: 1080 };
    expect(
      isRejected(scoreRelease(parsed({ resolution: 2160 }), capped, null)),
    ).toBe(true);
    expect(
      isRejected(scoreRelease(parsed({ resolution: 1080 }), capped, null)),
    ).toBe(false);
  });
});

describe("scoreRelease — source preferences", () => {
  test("BluRay outscores WEBRip with BluRay first in prefs", () => {
    const bluray = numScore(
      scoreRelease(parsed({ source: "BluRay" }), baseProfile, null),
    );
    const webrip = numScore(
      scoreRelease(parsed({ source: "WEBRip" }), baseProfile, null),
    );
    expect(bluray).toBeGreaterThan(webrip);
  });

  test("HDLight matches BluRay preference (French re-encode alias)", () => {
    const hdlight = scoreRelease(
      parsed({ source: "HDLight" }),
      baseProfile,
      null,
    );
    // HDLight aliases to BluRay — should get the same source score as BluRay
    const bluray = scoreRelease(
      parsed({ source: "BluRay" }),
      baseProfile,
      null,
    );
    expect(isRejected(hdlight)).toBe(false);
    expect(hdlight).toEqual(bluray);
  });

  test("HDRip matches WEBRip preference", () => {
    const prof = { ...baseProfile, preferredSources: ["WEBRip"] };
    const hdrip = scoreRelease(parsed({ source: "HDRip" }), prof, null);
    const webrip = scoreRelease(parsed({ source: "WEBRip" }), prof, null);
    expect(isRejected(hdrip)).toBe(false);
    expect(hdrip).toEqual(webrip);
  });

  test("REMUX matches BluRay preference", () => {
    const remux = numScore(
      scoreRelease(parsed({ source: "REMUX" }), baseProfile, null),
    );
    const bluray = numScore(
      scoreRelease(parsed({ source: "BluRay" }), baseProfile, null),
    );
    expect(remux).toEqual(bluray);
  });
});

describe("scoreRelease — PROPER/REPACK bonus", () => {
  test("PROPER scores +150 over identical non-PROPER", () => {
    const base = numScore(
      scoreRelease(parsed({ isProper: false }), baseProfile, null),
    );
    const proper = numScore(
      scoreRelease(parsed({ isProper: true }), baseProfile, null),
    );
    expect(proper - base).toBe(150);
  });

  test("PROPER still rejected if below min resolution", () => {
    expect(
      isRejected(
        scoreRelease(
          parsed({ resolution: 720, isProper: true }),
          baseProfile,
          null,
        ),
      ),
    ).toBe(true);
  });

  test("PROPER still rejected if isSample", () => {
    expect(
      isRejected(
        scoreRelease(
          parsed({ isSample: true, isProper: true }),
          baseProfile,
          null,
        ),
      ),
    ).toBe(true);
  });
});

describe("scoreRelease — HDR preferences", () => {
  test("preferHdr adds bonus when hdr present", () => {
    const no = numScore(
      scoreRelease(
        parsed({ hdr: null }),
        { ...baseProfile, preferHdr: true },
        null,
      ),
    );
    const yes = numScore(
      scoreRelease(
        parsed({ hdr: "HDR10" }),
        { ...baseProfile, preferHdr: true },
        null,
      ),
    );
    expect(yes).toBeGreaterThan(no);
  });

  test("requireHdr accepts release with hdr", () => {
    expect(
      isRejected(
        scoreRelease(
          parsed({ hdr: "DV" }),
          { ...baseProfile, requireHdr: true },
          null,
        ),
      ),
    ).toBe(false);
  });
});

describe("scoreRelease — codec preferences", () => {
  test("x265 outscores x264 when x265 is first preferred codec", () => {
    const hevc = numScore(
      scoreRelease(parsed({ codec: "x265" }), baseProfile, null),
    );
    const avc = numScore(
      scoreRelease(parsed({ codec: "x264" }), baseProfile, null),
    );
    expect(hevc).toBeGreaterThan(avc);
  });

  test("profile pref HEVC matches parsed codec x265 (alias)", () => {
    const hevcProfile = { ...baseProfile, preferredCodecs: ["HEVC", "AV1"] };
    const score = numScore(
      scoreRelease(parsed({ codec: "x265" }), hevcProfile, null),
    );
    const noCodec = numScore(
      scoreRelease(parsed({ codec: null }), hevcProfile, null),
    );
    expect(score).toBeGreaterThan(noCodec);
  });

  test("profile pref AVC matches parsed codec x264 (alias)", () => {
    const avcProfile = { ...baseProfile, preferredCodecs: ["AVC"] };
    const score = numScore(
      scoreRelease(parsed({ codec: "x264" }), avcProfile, null),
    );
    const noCodec = numScore(
      scoreRelease(parsed({ codec: null }), avcProfile, null),
    );
    expect(score).toBeGreaterThan(noCodec);
  });
});

describe("scoreRelease — large file penalty", () => {
  test("file >10GB is penalised when no maxSizeGb set", () => {
    // HDTV is not in baseProfile.preferredSources — a preferred source waives
    // the penalty (see "size penalty is waived for preferred sources").
    const unpreferred = parsed({ source: "HDTV" });
    const small = numScore(scoreRelease(unpreferred, baseProfile, 5e9));
    const large = numScore(scoreRelease(unpreferred, baseProfile, 50e9));
    expect(small).toBeGreaterThan(large);
  });
});

describe("scoreRelease — language hard filter", () => {
  test("rejects release with no matching language when languages are set", () => {
    const prof = { ...baseProfile, preferredLanguages: ["VF2", "VFQ"] };
    expect(
      isRejected(
        scoreRelease(parsed(), prof, null, "Movie.VFF.1080p.BluRay.x265"),
      ),
    ).toBe(true);
    expect(
      isRejected(scoreRelease(parsed(), prof, null, "Movie.1080p.BluRay.x265")),
    ).toBe(true);
  });

  test("accepts release whose language matches a preferred entry", () => {
    const prof = { ...baseProfile, preferredLanguages: ["VF2", "VFQ"] };
    expect(
      isRejected(
        scoreRelease(parsed(), prof, null, "Movie.MULTi.VF2.1080p.BluRay.x265"),
      ),
    ).toBe(false);
    expect(
      isRejected(
        scoreRelease(parsed(), prof, null, "Movie.MULTi.VFQ.1080p.BluRay.x265"),
      ),
    ).toBe(false);
  });

  test("VFF is rejected when only VF2 and VFQ are preferred", () => {
    const prof = { ...baseProfile, preferredLanguages: ["VF2", "VFQ"] };
    expect(
      isRejected(
        scoreRelease(parsed(), prof, null, "Movie.MULTi.VFF.1080p.BluRay.x265"),
      ),
    ).toBe(true);
  });

  test("no preferred languages — all releases pass the language check", () => {
    expect(
      isRejected(
        scoreRelease(
          parsed(),
          baseProfile,
          null,
          "Movie.VFF.1080p.BluRay.x265",
        ),
      ),
    ).toBe(false);
    expect(
      isRejected(
        scoreRelease(parsed(), baseProfile, null, "Movie.1080p.BluRay.x265"),
      ),
    ).toBe(false);
  });

  test("VFF ranks higher than FRENCH when both pass [VFF, fr] filter", () => {
    const prof = { ...baseProfile, preferredLanguages: ["VFF", "fr"] };
    const vff = numScore(
      scoreRelease(parsed(), prof, null, "Movie.VFF.1080p.BluRay.x265"),
    );
    const french = numScore(
      scoreRelease(parsed(), prof, null, "Movie.FRENCH.1080p.BluRay.x265"),
    );
    expect(vff).toBeGreaterThan(french);
  });

  test("generic fr rejects VFF release (VFF is a specific variant, not generic French)", () => {
    const frOnly = { ...baseProfile, preferredLanguages: ["fr"] };
    expect(
      isRejected(
        scoreRelease(parsed(), frOnly, null, "Movie.VFF.1080p.BluRay.x265"),
      ),
    ).toBe(true);
  });

  test("generic fr accepts FRENCH-labelled release", () => {
    const frOnly = { ...baseProfile, preferredLanguages: ["fr"] };
    expect(
      isRejected(
        scoreRelease(parsed(), frOnly, null, "Movie.FRENCH.1080p.BluRay.x265"),
      ),
    ).toBe(false);
  });

  test("VFQ preference rejects VFF release", () => {
    const vfqOnly = { ...baseProfile, preferredLanguages: ["VFQ"] };
    expect(
      isRejected(
        scoreRelease(parsed(), vfqOnly, null, "Movie.VFF.1080p.BluRay.x265"),
      ),
    ).toBe(true);
  });

  test("English preference rejects unlabelled release", () => {
    const enFirst = { ...baseProfile, preferredLanguages: ["en"] };
    expect(
      isRejected(
        scoreRelease(parsed(), enFirst, null, "Movie.1080p.BluRay.x265"),
      ),
    ).toBe(true);
    expect(
      isRejected(
        scoreRelease(
          parsed(),
          enFirst,
          null,
          "Movie.1080p.BluRay.ENG.DTS.x265",
        ),
      ),
    ).toBe(false);
  });

  test("Italian preference matches ITA, rejects non-Italian", () => {
    const itFirst = { ...baseProfile, preferredLanguages: ["it"] };
    expect(
      isRejected(
        scoreRelease(
          parsed(),
          itFirst,
          null,
          "Movie.1080p.BluRay.ita.eng.AC3.x265",
        ),
      ),
    ).toBe(false);
    expect(
      isRejected(
        scoreRelease(parsed(), itFirst, null, "Movie.1080p.BluRay.x265"),
      ),
    ).toBe(true);
  });
});
