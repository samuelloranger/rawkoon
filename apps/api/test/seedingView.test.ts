import { describe, expect, it } from "bun:test";
import type { NormalizedTorrent } from "@rawkoon/api/services/downloadClient/types";
import type { RuleContext } from "@rawkoon/api/services/seeding/seedPolicy";
import {
  buildOrphans,
  buildSeedRuleRows,
  buildSeedingTorrents,
  seedStateForRow,
  supersededIds,
  type HeldRow,
} from "@rawkoon/api/services/seeding/seedingView";

const H = "aa".repeat(20);
const GB = 1024 ** 3;
const t = (o: Partial<NormalizedTorrent> = {}): NormalizedTorrent => ({
  hash: H,
  name: "Film.2160p",
  state: "completed",
  progress: 1,
  savePath: "/dl",
  contentPath: "/dl/Film",
  seeds: 0,
  peers: 0,
  dlSpeed: 0,
  upSpeed: 1024 ** 2,
  seedingTimeSecs: 3600,
  category: "rawkoon-movies",
  sizeBytes: GB,
  labels: [],
  ratio: 0.5,
  ...o,
});
const ctx: RuleContext = {
  defaults: {
    publicRule: { ratio: 1, seedTimeMins: null },
    privateRule: { ratio: 1, seedTimeMins: 4320 },
  },
  overrides: new Map(),
  privacy: new Map([["nimbus", true]]),
};
const row = (o: Partial<HeldRow> = {}): HeldRow => ({
  id: 1,
  torrentHash: H,
  indexer: "Nimbus",
  grabbedAt: new Date("2026-01-01"),
  mediaId: 3,
  episodeId: null,
  bookEditionId: null,
  media: { id: 3, title: "Film", year: 1922, posterUrl: null, type: "movie" },
  book: null,
  ...o,
});

describe("buildSeedingTorrents", () => {
  it("builds a held row with progress, the lead target and the private flag", () => {
    const [s] = buildSeedingTorrents([row()], [t()], ctx, new Set());
    expect(s).toMatchObject({
      title: "Film",
      year: 1922,
      kind_label: "movie",
      is_private: true,
      owes_seed_time: true,
      lead: "ratio",
      eta_secs: 512,
      target_met: false,
      rule_source: "private_default",
    });
    expect(s.rule).toEqual({ ratio: 1, seed_time_mins: 4320 });
  });
  it("badges removed titles and superseded grabs", () => {
    const [s] = buildSeedingTorrents(
      [row({ mediaId: null, media: null })],
      [t()],
      ctx,
      new Set([1]),
    );
    expect(s.badges).toEqual(["removed_from_library", "replaced_by_upgrade"]);
    expect(s.title).toBe("Film.2160p");
  });
  it("omits hashes the client no longer has", () => {
    expect(buildSeedingTorrents([row()], [], ctx, new Set())).toEqual([]);
  });
});

describe("supersededIds", () => {
  it("flags a grab replaced by a newer completed grab for the same target", () => {
    const held = [row({ id: 1, grabbedAt: new Date("2026-01-01") })];
    const completed = [
      {
        id: 2,
        mediaId: 3,
        episodeId: null,
        bookEditionId: null,
        grabbedAt: new Date("2026-02-01"),
      },
    ];
    expect([...supersededIds(held, completed)]).toEqual([1]);
  });
});

describe("buildOrphans", () => {
  it("lists unowned rawkoon torrents with totals and a shared-data flag", () => {
    const orphan = t({ hash: "bb".repeat(20), contentPath: "/dl/X" });
    const twin = t({
      hash: "cc".repeat(20),
      category: "radarr",
      contentPath: "/dl/X",
    });
    const res = buildOrphans([t(), orphan, twin], new Set([H]));
    expect(res.orphans.map((o) => o.hash)).toEqual(["bb".repeat(20)]);
    expect(res.orphans[0].shares_data).toBe(true);
    expect(res.total_bytes).toBe(GB);
  });
});

describe("buildSeedRuleRows", () => {
  it("shows inherited and overridden rules with held counts, including override-only indexers", () => {
    const rows = buildSeedRuleRows(
      [
        { name: "Nimbus", isPrivate: true },
        { name: "Harbor", isPrivate: false },
      ],
      [{ indexerName: "Gone", ratio: 3, seedTimeMins: null }],
      new Map([["nimbus", 2]]),
      {
        ...ctx,
        privacy: new Map([
          ["nimbus", true],
          ["harbor", false],
        ]),
      },
    );
    expect(rows.find((r) => r.indexer === "Nimbus")).toMatchObject({
      source: "private_default",
      held_count: 2,
      override: null,
    });
    expect(rows.find((r) => r.indexer === "Harbor")).toMatchObject({
      source: "public_default",
      held_count: 0,
    });
    expect(rows.find((r) => r.indexer === "Gone")?.override).toEqual({
      ratio: 3,
      seed_time_mins: null,
    });
  });
});

describe("seedStateForRow", () => {
  const base = {
    failed: false,
    completedAt: new Date(),
    seedReleasedAt: null,
    seedReleaseReason: null,
  };
  it("is seeding while owned and present", () => {
    expect(seedStateForRow(base, t())).toEqual({
      state: "seeding",
      reason: null,
      ratio: 0.5,
      seeding_time_secs: 3600,
    });
  });
  it("is blocklisted for janitor reasons and released otherwise", () => {
    expect(
      seedStateForRow(
        {
          ...base,
          failed: true,
          seedReleasedAt: new Date(),
          seedReleaseReason: "stalled",
        },
        undefined,
      )?.state,
    ).toBe("blocklisted");
    expect(
      seedStateForRow(
        {
          ...base,
          seedReleasedAt: new Date(),
          seedReleaseReason: "target_met",
        },
        undefined,
      )?.state,
    ).toBe("released");
  });
  it("is null for in-flight rows", () => {
    expect(
      seedStateForRow({ ...base, completedAt: null }, t({ progress: 0.2 })),
    ).toBeNull();
  });
});
