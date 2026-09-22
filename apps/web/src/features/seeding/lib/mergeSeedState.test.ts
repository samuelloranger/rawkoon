import { describe, expect, it } from "vitest";
import type { SeedingResponse, SeedingTorrent } from "@rawkoon/shared/types";
import { mergeSeedState } from "./mergeSeedState";

const row = (o: Partial<SeedingTorrent> = {}): SeedingTorrent => ({
  hash: "aa",
  name: "n",
  title: "Film",
  year: 1922,
  kind_label: "movie",
  media_id: 1,
  book_id: null,
  poster_url: null,
  indexer: "Nimbus",
  is_private: true,
  badges: [],
  rule: { ratio: 1, seed_time_mins: 4320 },
  rule_source: "private_default",
  ratio: 0.5,
  seeding_time_secs: 3600,
  up_speed: 10,
  size_bytes: 100,
  ratio_pct: 0.5,
  time_pct: 1 / 72,
  lead: "ratio",
  eta_secs: 50,
  target_met: false,
  owes_seed_time: true,
  ...o,
});
const base: SeedingResponse = {
  enabled: true,
  torrents: [row(), row({ hash: "bb", eta_secs: 10 })],
  released_today: [],
};

describe("mergeSeedState", () => {
  it("patches live numbers and recomputes progress", () => {
    const next = mergeSeedState(base, {
      kind: "seed-state",
      ts: 1,
      torrents: [
        {
          hash: "aa",
          ratio: 0.75,
          seedingTimeSecs: 7200,
          upSpeed: 5,
          etaSecs: 20,
        },
      ],
    });
    const aa = next?.torrents.find((t) => t.hash === "aa");
    expect(aa).toMatchObject({
      ratio: 0.75,
      ratio_pct: 0.75,
      seeding_time_secs: 7200,
      up_speed: 5,
      eta_secs: 20,
    });
  });
  it("moves a released torrent into released_today", () => {
    const next = mergeSeedState(base, {
      kind: "seed-state",
      ts: 1,
      torrents: [
        {
          hash: "bb",
          ratio: 1,
          seedingTimeSecs: 1,
          upSpeed: 0,
          etaSecs: 0,
          released: {
            reason: "target_met",
            at: "2026-01-01T00:00:00.000Z",
            freedBytes: 100,
          },
        },
      ],
    });
    expect(next?.torrents.map((t) => t.hash)).toEqual(["aa"]);
    expect(next?.released_today[0]).toMatchObject({
      hash: "bb",
      title: "Film",
      reason: "target_met",
      size_bytes: 100,
    });
  });
  it("leaves an unknown cache untouched", () => {
    expect(
      mergeSeedState(undefined, { kind: "seed-state", ts: 1, torrents: [] }),
    ).toBeUndefined();
  });
});
