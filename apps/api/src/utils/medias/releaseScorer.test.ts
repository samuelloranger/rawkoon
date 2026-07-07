import { describe, expect, test } from "bun:test";
import type { ParsedRelease } from "@rawkoon/api/utils/medias/filenameParser";
import type {
  AssignedCustomFormat,
  ReleaseEvalContext,
} from "@rawkoon/api/utils/medias/customFormatTypes";
import {
  scoreRelease,
  scoreReleaseDetailed,
  type QualityProfileScoreInput,
} from "@rawkoon/api/utils/medias/releaseScorer";

/** Returns true when scoreRelease rejected the release (returned reason codes). */
function isRejected(result: number | string[]): boolean {
  return Array.isArray(result);
}

/** Extracts the numeric score; throws if the release was rejected. */
function numScore(result: number | string[]): number {
  if (Array.isArray(result)) throw new Error("Release was rejected");
  return result;
}

const baseProfile: QualityProfileScoreInput = {
  minResolution: 1080,
  cutoffResolution: null,
  preferredSources: ["BluRay", "WEB-DL"],
  preferredCodecs: ["x265", "x264"],
  preferredLanguages: [],
  prioritizedTrackers: [],
  preferTrackerOverQuality: false,
  maxSizeGb: null,
  requireHdr: false,
  preferHdr: false,
  minSeeders: 0,
  customFormats: [],
};

function parsed(overrides: Partial<ParsedRelease> = {}): ParsedRelease {
  return {
    resolution: 1080,
    source: "BluRay",
    codec: "x265",
    hdr: null,
    audio: null,
    group: null,
    streaming: null,
    isSample: false,
    isProper: false,
    ...overrides,
  };
}

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
    const small = numScore(scoreRelease(parsed(), baseProfile, 5e9));
    const large = numScore(scoreRelease(parsed(), baseProfile, 50e9));
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

describe("tracker priority bonus", () => {
  const trackerProfile = {
    ...baseProfile,
    prioritizedTrackers: ["Alpha", "Beta (API)", "Gamma"],
  };

  test("tie-breaker mode: #1 tracker beats #3 by 200 pts", () => {
    const s1 = numScore(
      scoreRelease(parsed(), trackerProfile, null, undefined, "Alpha"),
    );
    const s3 = numScore(
      scoreRelease(parsed(), trackerProfile, null, undefined, "Gamma"),
    );
    expect(s1 - s3).toBe(200); // 300 - 100 = 200
  });

  test("tracker not in list gets no bonus", () => {
    const withTracker = numScore(
      scoreRelease(parsed(), trackerProfile, null, undefined, "Alpha"),
    );
    const noTracker = numScore(
      scoreRelease(
        parsed(),
        trackerProfile,
        null,
        undefined,
        "UnlistedTracker",
      ),
    );
    expect(withTracker - noTracker).toBe(300);
  });

  test("no trackers configured: indexerName has no effect", () => {
    const s1 = scoreRelease(parsed(), baseProfile, null, undefined, "Alpha");
    const s2 = scoreRelease(
      parsed(),
      baseProfile,
      null,
      undefined,
      "UnlistedTracker",
    );
    expect(s1).toBe(s2);
  });

  test("prefer-tracker mode: #1 tracker (+1500) beats a 4K release from an unprioritized tracker", () => {
    const preferMode = { ...trackerProfile, preferTrackerOverQuality: true };
    // 4K from UnlistedTracker (not prioritized): resolution tier delta = 1 → +1000
    const unprioritized4k = numScore(
      scoreRelease(
        parsed({ resolution: 2160 }),
        preferMode,
        null,
        undefined,
        "UnlistedTracker",
      ),
    );
    // 1080p from Alpha (#1 tracker): tier delta = 0, tracker bonus = +1500
    const prioritized1080p = numScore(
      scoreRelease(
        parsed({ resolution: 1080 }),
        preferMode,
        null,
        undefined,
        "Alpha",
      ),
    );
    expect(prioritized1080p).toBeGreaterThan(unprioritized4k);
  });
});

function ctxOf(
  p: ReturnType<typeof parsed>,
  over: Partial<ReleaseEvalContext> = {},
): ReleaseEvalContext {
  return {
    parsed: p,
    rawTitle: "Movie.2024.1080p.BluRay.x265-GROUP",
    sizeBytes: 5_000_000_000,
    indexerName: null,
    seeders: 50,
    freeleech: false,
    ...over,
  };
}

describe("rejection codes (i18n-safe)", () => {
  test("below min resolution → code resolution_below_min", () => {
    const r = scoreRelease(parsed({ resolution: 720 }), baseProfile, null);
    expect(r).toEqual(["resolution_below_min"]);
  });

  test("require HDR absent → hdr_required_absent", () => {
    const r = scoreRelease(
      parsed(),
      { ...baseProfile, requireHdr: true },
      null,
    );
    expect(r).toEqual(["hdr_required_absent"]);
  });
});

describe("minSeeders gate", () => {
  test("rejects below minSeeders → seeders_below_min", () => {
    const b = scoreReleaseDetailed(ctxOf(parsed(), { seeders: 2 }), {
      ...baseProfile,
      minSeeders: 5,
    });
    expect(b.rejected).toBe(true);
    if (b.rejected)
      expect(b.reasons.map((x) => x.code)).toContain("seeders_below_min");
  });

  test("null seeders is NOT rejected by the gate", () => {
    const b = scoreReleaseDetailed(ctxOf(parsed(), { seeders: null }), {
      ...baseProfile,
      minSeeders: 5,
    });
    expect(b.rejected).toBe(false);
  });
});

describe("custom format pass", () => {
  const atmos: AssignedCustomFormat = {
    name: "Atmos",
    conditions: [{ type: "title_regex", operator: "matches", value: "atmos" }],
    score: 200,
    required: false,
    forbidden: false,
  };

  test("matched format adds its score and appears in components", () => {
    const b = scoreReleaseDetailed(
      ctxOf(parsed(), { rawTitle: "Movie.2024.1080p.BluRay.Atmos.x265-GROUP" }),
      { ...baseProfile, customFormats: [atmos] },
    );
    expect(b.rejected).toBe(false);
    if (!b.rejected) {
      expect(b.matchedFormats).toContain("Atmos");
      expect(
        b.components.find((c) => c.code === "custom_format" && c.value === 200),
      ).toBeDefined();
    }
  });

  test("forbidden format present → rejected", () => {
    const b = scoreReleaseDetailed(
      ctxOf(parsed(), { rawTitle: "Movie.2024.1080p.BluRay.Atmos.x265-GROUP" }),
      { ...baseProfile, customFormats: [{ ...atmos, forbidden: true }] },
    );
    expect(b.rejected).toBe(true);
    if (b.rejected)
      expect(b.reasons[0].code).toBe("custom_format_forbidden_present");
  });

  test("required format absent → rejected", () => {
    const b = scoreReleaseDetailed(ctxOf(parsed()), {
      ...baseProfile,
      customFormats: [{ ...atmos, required: true }],
    });
    expect(b.rejected).toBe(true);
    if (b.rejected)
      expect(b.reasons[0].code).toBe("custom_format_required_absent");
  });
});

describe("regression: no custom formats, minSeeders 0 → identical total", () => {
  test("score matches a hand-computed baseline", () => {
    // 1080p == minResolution (tier delta 0), source BluRay is preferredSources[0] (+500),
    // codec x265 is preferredCodecs[0] (+200) → 700.
    const r = scoreRelease(
      parsed(),
      baseProfile,
      5_000_000_000,
      "Movie.2024.1080p.BluRay.x265-GROUP",
    );
    expect(r).toBe(700);
  });
});

describe("score breakdown components", () => {
  test("size_penalty component for large file with no maxSizeGb", () => {
    const b = scoreReleaseDetailed(
      ctxOf(parsed(), { sizeBytes: 15_000_000_000 }),
      baseProfile,
    );
    expect(b.rejected).toBe(false);
    if (!b.rejected) {
      expect(b.components.find((c) => c.code === "size_penalty")?.value).toBe(
        -250,
      ); // floor(15-10)*50
    }
  });

  test("tracker_priority component when indexer is prioritized", () => {
    const b = scoreReleaseDetailed(
      ctxOf(parsed(), { indexerName: "TopTracker" }),
      {
        ...baseProfile,
        prioritizedTrackers: ["TopTracker"],
        preferTrackerOverQuality: false,
      },
    );
    expect(b.rejected).toBe(false);
    if (!b.rejected) {
      expect(
        b.components.find(
          (c) => c.code === "tracker_priority" && c.value === 300,
        ),
      ).toBeDefined();
    }
  });

  test("multiple formats: only matched ones contribute a component", () => {
    const atmos: AssignedCustomFormat = {
      name: "Atmos",
      conditions: [
        { type: "title_regex", operator: "matches", value: "atmos" },
      ],
      score: 200,
      required: false,
      forbidden: false,
    };
    const dv: AssignedCustomFormat = {
      name: "DV",
      conditions: [
        { type: "title_regex", operator: "matches", value: "dolby.?vision" },
      ],
      score: 300,
      required: false,
      forbidden: false,
    };
    const b = scoreReleaseDetailed(
      ctxOf(parsed(), { rawTitle: "Movie.2024.1080p.BluRay.Atmos.x265-GROUP" }),
      { ...baseProfile, customFormats: [atmos, dv] },
    );
    expect(b.rejected).toBe(false);
    if (!b.rejected) {
      expect(b.matchedFormats).toEqual(["Atmos"]);
      expect(
        b.components.filter((c) => c.code === "custom_format"),
      ).toHaveLength(1);
    }
  });

  test("matched format with score 0 emits no component but still counts as matched", () => {
    const zero: AssignedCustomFormat = {
      name: "Zero",
      conditions: [{ type: "source", operator: "equals", value: "BluRay" }],
      score: 0,
      required: false,
      forbidden: false,
    };
    const b = scoreReleaseDetailed(ctxOf(parsed()), {
      ...baseProfile,
      customFormats: [zero],
    });
    expect(b.rejected).toBe(false);
    if (!b.rejected) {
      expect(b.matchedFormats).toContain("Zero");
      expect(
        b.components.find((c) => c.code === "custom_format"),
      ).toBeUndefined();
    }
  });
});
