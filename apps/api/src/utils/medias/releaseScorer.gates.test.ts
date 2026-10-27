import { describe, expect, test } from "bun:test";
import type {
  AssignedCustomFormat,
  ReleaseEvalContext,
} from "@rawkoon/api/utils/medias/customFormatTypes";
import {
  scoreRelease,
  scoreReleaseDetailed,
  type QualityProfileScoreInput,
} from "@rawkoon/api/utils/medias/releaseScorer";
import {
  baseProfile,
  isRejected,
  numScore,
  parsed,
} from "./releaseScorer.helpers";

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
    // 1080p == minResolution (tier delta 0), source BluRay is preferredSources[0] (+800),
    // codec x265 is preferredCodecs[0] (+200) → 1000.
    const r = scoreRelease(
      parsed(),
      baseProfile,
      5_000_000_000,
      "Movie.2024.1080p.BluRay.x265-GROUP",
    );
    expect(r).toBe(1000);
  });
});

describe("score breakdown components", () => {
  test("size_penalty component for large file with no maxSizeGb", () => {
    // HDTV is absent from baseProfile.preferredSources — a preferred source
    // waives the penalty entirely (see "size penalty is waived" below).
    const b = scoreReleaseDetailed(
      ctxOf(parsed({ source: "HDTV" }), { sizeBytes: 15_000_000_000 }),
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

describe("source ranking spread", () => {
  const fiveSources: QualityProfileScoreInput = {
    ...baseProfile,
    preferredSources: ["REMUX", "BluRay", "WEB-DL", "WEBRip", "HDTV"],
    preferredCodecs: [],
  };

  function sourceScore(
    source: string,
    profile: QualityProfileScoreInput = fiveSources,
  ): number {
    const b = scoreReleaseDetailed(
      ctxOf(parsed({ source, codec: null }), { sizeBytes: null }),
      profile,
    );
    if (b.rejected) throw new Error("Release was rejected");
    return b.components.find((c) => c.code === "preferred_source")?.value ?? 0;
  }

  test("every rank in a full five-source profile gets a distinct score", () => {
    const scores = ["REMUX", "BluRay", "WEB-DL", "WEBRip", "HDTV"].map((s) =>
      sourceScore(s),
    );
    expect(scores).toEqual([800, 600, 400, 200, 0]);
    expect(new Set(scores).size).toBe(scores.length);
  });

  test("reordering the profile flips which source wins", () => {
    const webFirst: QualityProfileScoreInput = {
      ...baseProfile,
      preferredSources: ["WEB-DL", "BluRay"],
      preferredCodecs: [],
    };
    const blurayFirst: QualityProfileScoreInput = {
      ...baseProfile,
      preferredSources: ["BluRay", "WEB-DL"],
      preferredCodecs: [],
    };
    expect(sourceScore("BluRay", blurayFirst)).toBeGreaterThan(
      sourceScore("WEB-DL", blurayFirst),
    );
    expect(sourceScore("WEB-DL", webFirst)).toBeGreaterThan(
      sourceScore("BluRay", webFirst),
    );
  });

  test("source rank never outweighs a resolution tier", () => {
    const best2160 = scoreReleaseDetailed(
      ctxOf(parsed({ resolution: 2160, source: "HDTV" }), { sizeBytes: null }),
      fiveSources,
    );
    const best1080 = scoreReleaseDetailed(
      ctxOf(parsed({ resolution: 1080, source: "REMUX" }), { sizeBytes: null }),
      fiveSources,
    );
    if (best2160.rejected || best1080.rejected)
      throw new Error("Release was rejected");
    expect(best2160.total).toBeGreaterThan(best1080.total);
  });
});

describe("size penalty is waived for preferred sources", () => {
  const bigFile = { sizeBytes: 40_000_000_000 };

  test("no size_penalty when the source is in preferredSources", () => {
    const b = scoreReleaseDetailed(ctxOf(parsed(), bigFile), baseProfile);
    expect(b.rejected).toBe(false);
    if (!b.rejected)
      expect(
        b.components.find((c) => c.code === "size_penalty"),
      ).toBeUndefined();
  });

  test("size_penalty still applies to a source not in preferredSources", () => {
    const b = scoreReleaseDetailed(
      ctxOf(parsed({ source: "HDTV" }), bigFile),
      baseProfile,
    );
    expect(b.rejected).toBe(false);
    if (!b.rejected)
      expect(b.components.find((c) => c.code === "size_penalty")?.value).toBe(
        -1500,
      ); // floor(40-10)*50
  });

  test("a 4K remux beats a small 4K WEB-DL when REMUX is preferred", () => {
    const profile: QualityProfileScoreInput = {
      ...baseProfile,
      preferredSources: ["REMUX", "WEB-DL"],
      preferredCodecs: [],
    };
    const remux = scoreReleaseDetailed(
      ctxOf(parsed({ resolution: 2160, source: "REMUX", codec: null }), {
        sizeBytes: 40_000_000_000,
      }),
      profile,
    );
    const webdl = scoreReleaseDetailed(
      ctxOf(parsed({ resolution: 2160, source: "WEB-DL", codec: null }), {
        sizeBytes: 15_000_000_000,
      }),
      profile,
    );
    if (remux.rejected || webdl.rejected) throw new Error("rejected");
    expect(remux.total).toBeGreaterThan(webdl.total);
  });

  test("maxSizeGb still rejects an oversized preferred source", () => {
    const r = scoreRelease(parsed(), { ...baseProfile, maxSizeGb: 20 }, 40e9);
    expect(r).toEqual(["size_over_cap"]);
  });
});
