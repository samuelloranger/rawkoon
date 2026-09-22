import { describe, expect, it } from "bun:test";
import type { NormalizedTorrent } from "@rawkoon/api/services/downloadClient/types";
import {
  classifyOrphans,
  findBlockedFile,
  governingProgress,
  isRawkoonOwned,
  isSeedTargetMet,
  normalizeExtension,
  resolveIndexerRule,
  seedProgress,
  sharesContentPath,
  type RuleContext,
} from "@rawkoon/api/services/seeding/seedPolicy";

const GB = 1024 ** 3;

function torrent(o: Partial<NormalizedTorrent> = {}): NormalizedTorrent {
  return {
    hash: "a".repeat(40),
    name: "T",
    state: "completed",
    progress: 1,
    savePath: "/dl",
    contentPath: "/dl/T",
    seeds: 0,
    peers: 0,
    dlSpeed: 0,
    upSpeed: 0,
    seedingTimeSecs: 0,
    category: "rawkoon-movies",
    sizeBytes: GB,
    labels: [],
    ratio: 0,
    ...o,
  };
}

const ctx: RuleContext = {
  defaults: {
    publicRule: { ratio: 1, seedTimeMins: null },
    privateRule: { ratio: 1, seedTimeMins: 4320 },
  },
  overrides: new Map([["quarry", { ratio: 2, seedTimeMins: 10080 }]]),
  privacy: new Map([
    ["nimbus", true],
    ["harbor", false],
    ["quarry", true],
  ]),
};

describe("resolveIndexerRule", () => {
  it("prefers an override", () => {
    expect(resolveIndexerRule("Quarry", ctx)).toEqual({
      rule: { ratio: 2, seedTimeMins: 10080 },
      source: "override",
      isPrivate: true,
    });
  });
  it("uses the private default for a private indexer", () => {
    expect(resolveIndexerRule(" nimbus ", ctx).source).toBe("private_default");
  });
  it("uses the public default for a public indexer", () => {
    expect(resolveIndexerRule("Harbor", ctx)).toMatchObject({
      source: "public_default",
      isPrivate: false,
    });
  });
  it("treats a target of 0 as no target, never as met immediately", () => {
    const zero = {
      ...ctx,
      overrides: new Map([["quarry", { ratio: 0, seedTimeMins: 4320 }]]),
    };
    expect(resolveIndexerRule("Quarry", zero).rule).toEqual({
      ratio: null,
      seedTimeMins: 4320,
    });
  });

  it("treats unknown and null indexers as private", () => {
    expect(resolveIndexerRule("Mystery", ctx).source).toBe("private_default");
    expect(resolveIndexerRule(null, ctx).isPrivate).toBe(true);
  });
});

describe("isSeedTargetMet", () => {
  const stats = {
    ratio: 0.5,
    seedingTimeSecs: 3600,
    upSpeed: 0,
    sizeBytes: GB,
  };
  it("is met immediately when no target is set", () => {
    expect(isSeedTargetMet(stats, { ratio: null, seedTimeMins: null })).toBe(
      true,
    );
  });
  it("is met by either target", () => {
    expect(
      isSeedTargetMet({ ...stats, ratio: 1 }, { ratio: 1, seedTimeMins: 4320 }),
    ).toBe(true);
    expect(
      isSeedTargetMet(
        { ...stats, seedingTimeSecs: 4320 * 60 },
        { ratio: 1, seedTimeMins: 4320 },
      ),
    ).toBe(true);
  });
  it("is not met when neither target is reached", () => {
    expect(isSeedTargetMet(stats, { ratio: 1, seedTimeMins: 4320 })).toBe(
      false,
    );
  });
  it("never counts a null client reading as met", () => {
    expect(
      isSeedTargetMet(
        { ...stats, ratio: null },
        { ratio: 1, seedTimeMins: null },
      ),
    ).toBe(false);
  });
});

describe("seedProgress", () => {
  it("leads with the target that will be met first", () => {
    // ratio: 0.5 of 1.0 on 1 GiB at 1 MiB/s → 512 s; time: 72 h - 1 h → 255600 s
    const p = seedProgress(
      { ratio: 0.5, seedingTimeSecs: 3600, upSpeed: 1024 ** 2, sizeBytes: GB },
      { ratio: 1, seedTimeMins: 4320 },
    );
    expect(p.lead).toBe("ratio");
    expect(p.etaSecs).toBe(512);
    expect(p.ratioPct).toBe(0.5);
    expect(p.met).toBe(false);
  });
  it("cannot reach a ratio-only target while idle", () => {
    const p = seedProgress(
      { ratio: 0.05, seedingTimeSecs: 10, upSpeed: 0, sizeBytes: GB },
      { ratio: 1, seedTimeMins: null },
    );
    expect(p.etaSecs).toBeNull();
    expect(p.timePct).toBeNull();
  });
});

describe("governingProgress", () => {
  it("is met only when every rule is met, and reports the slowest", () => {
    const stats = {
      ratio: 1.2,
      seedingTimeSecs: 3600,
      upSpeed: 0,
      sizeBytes: GB,
    };
    const g = governingProgress(stats, [
      { ratio: 1, seedTimeMins: null },
      { ratio: null, seedTimeMins: 120 },
    ]);
    expect(g.met).toBe(false);
    expect(g.rule).toEqual({ ratio: null, seedTimeMins: 120 });
    expect(g.etaSecs).toBe(3600);
  });
});

describe("ownership and orphans", () => {
  it("recognises the rawkoon category and the per-download tag", () => {
    expect(isRawkoonOwned(torrent())).toBe(true);
    expect(
      isRawkoonOwned(torrent({ category: null, labels: ["rawkoon-dh-12"] })),
    ).toBe(true);
    expect(
      isRawkoonOwned(torrent({ category: "tv-sonarr", labels: ["other"] })),
    ).toBe(false);
  });
  it("detects a cross-seed sharing the content path", () => {
    const a = torrent({ hash: "a".repeat(40), contentPath: "/dl/Film/" });
    const b = torrent({ hash: "b".repeat(40), contentPath: "/dl/Film" });
    expect(sharesContentPath(a, [a, b])).toBe(true);
    expect(sharesContentPath(a, [a])).toBe(false);
  });
  it("treats a torrent nested inside another's folder as sharing data, at path boundaries only", () => {
    const pack = torrent({ hash: "a".repeat(40), contentPath: "/dl/Show.S01" });
    const episode = torrent({
      hash: "b".repeat(40),
      contentPath: "/dl/Show.S01/Show.S01E02.mkv",
    });
    const lookalike = torrent({
      hash: "c".repeat(40),
      contentPath: "/dl/Show.S01.Extras",
    });
    expect(sharesContentPath(pack, [pack, episode])).toBe(true);
    expect(sharesContentPath(episode, [pack, episode])).toBe(true);
    expect(sharesContentPath(pack, [pack, lookalike])).toBe(false);
  });

  it("does not call a torrent an orphan when a live row owns it through its per-download tag", () => {
    const tagged = torrent({ hash: "e".repeat(40), labels: ["rawkoon-dh-42"] });
    const staleTag = torrent({
      hash: "f".repeat(40),
      labels: ["rawkoon-dh-7"],
    });
    const out = classifyOrphans([tagged, staleTag], new Set(), new Set([42]));
    expect(out.map((t) => t.hash)).toEqual(["f".repeat(40)]);
  });

  it("classifies orphans case-insensitively and ignores foreign torrents", () => {
    const owned = torrent({ hash: "A".repeat(40) });
    const orphan = torrent({ hash: "c".repeat(40) });
    const foreign = torrent({
      hash: "d".repeat(40),
      category: "radarr",
      labels: [],
    });
    const out = classifyOrphans(
      [owned, orphan, foreign],
      new Set(["a".repeat(40)]),
    );
    expect(out.map((t) => t.hash)).toEqual(["c".repeat(40)]);
  });
});

describe("blocked files", () => {
  it("normalizes user input", () => {
    expect(normalizeExtension(" .EXE ")).toBe("exe");
    expect(normalizeExtension("tar.gz")).toBeNull();
    expect(normalizeExtension("")).toBeNull();
  });
  it("matches the final segment's extension only", () => {
    const exts = ["exe", "lnk"];
    expect(findBlockedFile(["Movie/movie.mkv", "Movie/Setup.EXE"], exts)).toBe(
      "Movie/Setup.EXE",
    );
    expect(findBlockedFile(["Movie.exe/movie.mkv"], exts)).toBeNull();
    expect(findBlockedFile(["Movie/movie.mkv"], [])).toBeNull();
  });
});
