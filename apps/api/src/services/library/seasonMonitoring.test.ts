import { describe, expect, it, mock } from "bun:test";

const updates: Array<{ where: unknown; data: unknown }> = [];
let rows: Array<{ id: number; season: number; airDate: Date | null }> = [];

mock.module("@rawkoon/api/db", () => ({
  prisma: {
    libraryEpisode: {
      findMany: async () => rows,
      updateMany: async (a: { where: unknown; data: unknown }) => {
        updates.push(a);
        return { count: 0 };
      },
    },
    libraryMedia: { update: async () => ({}) },
  },
}));

const { applySeasonChoice, planMonitoredEpisodes, resolveSeasonChoice } =
  await import("./seasonMonitoring");

const NOW = new Date("2026-06-01T00:00:00Z");
const past = new Date("2026-01-01T00:00:00Z");
const future = new Date("2026-12-01T00:00:00Z");

// s1, s2 aired; s3 has one aired + two to come; s4 announced, nothing aired; s0 special.
const eps = [
  { id: 1, season: 1, airDate: past },
  { id: 2, season: 1, airDate: past },
  { id: 3, season: 2, airDate: past },
  { id: 4, season: 3, airDate: past },
  { id: 5, season: 3, airDate: future },
  { id: 6, season: 3, airDate: null },
  { id: 7, season: 4, airDate: future },
  { id: 8, season: 0, airDate: past },
];
const plan = (
  seasonMode: "all" | "future" | "latest" | "pick",
  seasons?: number[],
) => [...planMonitoredEpisodes({ seasonMode, seasons }, eps, NOW)].sort();

describe("planMonitoredEpisodes", () => {
  it("all: every regular episode, never specials", () => {
    expect(plan("all")).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("future: unaired or undated episodes only", () => {
    expect(plan("future")).toEqual([5, 6, 7]);
  });

  it("latest: the newest season with an aired episode, plus everything to come", () => {
    expect(plan("latest")).toEqual([4, 5, 6, 7]);
  });

  it("latest ignores an announced season with nothing aired", () => {
    const only = [
      { id: 1, season: 1, airDate: past },
      { id: 2, season: 2, airDate: future },
    ];
    expect([
      ...planMonitoredEpisodes({ seasonMode: "latest" }, only, NOW),
    ]).toEqual([1, 2]);
  });

  it("latest on a show with nothing aired monitors only the future episodes", () => {
    const none = [{ id: 1, season: 1, airDate: future }];
    expect([
      ...planMonitoredEpisodes({ seasonMode: "latest" }, none, NOW),
    ]).toEqual([1]);
  });

  it("pick: only the listed seasons", () => {
    expect(plan("pick", [2, 4])).toEqual([3, 7]);
  });

  it("pick with no seasons monitors nothing", () => {
    expect(plan("pick", [])).toEqual([]);
  });
});

describe("applySeasonChoice", () => {
  it("monitors the plan and unmonitors the rest of the regular episodes", async () => {
    rows = eps;
    updates.length = 0;
    // The helper reads the real clock; "all" is clock-independent.
    await applySeasonChoice(9, { seasonMode: "all" });
    expect(updates).toHaveLength(2);
    expect(updates[0]?.data).toEqual({ monitored: true });
    expect(updates[1]?.data).toEqual({ monitored: false });
    expect(JSON.stringify(updates[0]?.where)).toContain("[1,2,3,4,5,6,7]");
  });
});

describe("resolveSeasonChoice", () => {
  it("falls back to the settings defaults", () => {
    expect(
      resolveSeasonChoice(
        {},
        { defaultSeasonMode: "latest", defaultMonitorNewSeasons: false },
      ),
    ).toEqual({
      choice: { seasonMode: "latest", seasons: undefined },
      monitorNewSeasons: false,
    });
  });

  it("defaults to all seasons with new seasons monitored when nothing is set", () => {
    expect(resolveSeasonChoice({}, null)).toEqual({
      choice: { seasonMode: "all", seasons: undefined },
      monitorNewSeasons: true,
    });
  });

  it("forces monitorNewSeasons on for future", () => {
    expect(
      resolveSeasonChoice(
        { seasonMode: "future", monitorNewSeasons: false },
        null,
      ),
    ).toMatchObject({ monitorNewSeasons: true });
  });

  it("rejects pick without seasons and seasons without pick", () => {
    expect(resolveSeasonChoice({ seasonMode: "pick" }, null)).toHaveProperty(
      "error",
    );
    expect(
      resolveSeasonChoice({ seasonMode: "pick", seasons: [] }, null),
    ).toHaveProperty("error");
    expect(
      resolveSeasonChoice({ seasonMode: "all", seasons: [1] }, null),
    ).toHaveProperty("error");
  });
});
