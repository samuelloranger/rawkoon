import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";

// The episode sync decides each new episode's monitored flag from the show's new-season setting.
let monitorNewSeasons = true;
let known: Array<{ season: number; monitored: boolean }> = [];
const created: Array<{ season: number; episode: number; monitored: boolean }> =
  [];

mock.module("@rawkoon/api/db", () => ({
  prisma: {
    libraryMedia: { findUnique: async () => ({ monitorNewSeasons }) },
    libraryEpisode: {
      findMany: async () => known,
      upsert: async (a: {
        create: { season: number; episode: number; monitored: boolean };
      }) => {
        created.push(a.create);
        return {};
      },
    },
  },
}));

const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: string) => {
  const u = String(url);
  const season = u.match(/season\/(\d+)/)?.[1];
  const body = season
    ? {
        episodes: [
          { id: 1, episode_number: 1, name: "a", air_date: "2026-01-01" },
          { id: 2, episode_number: 2, name: "b", air_date: null },
        ],
      }
    : {
        seasons: [
          { season_number: 0, episode_count: 1 },
          { season_number: 1, episode_count: 2 },
          { season_number: 2, episode_count: 2 },
        ],
      };
  return new Response(JSON.stringify(body));
}) as unknown as typeof fetch;

const { upsertLibraryShowEpisodesFromTmdb } = await import(
  "@rawkoon/api/utils/medias/libraryHelpers"
);

afterAll(() => {
  globalThis.fetch = realFetch;
});

const run = () =>
  upsertLibraryShowEpisodesFromTmdb({ mediaId: 1, tmdbShowId: 5, apiKey: "k" });
const monitoredOf = (season: number) =>
  created.filter((e) => e.season === season).map((e) => e.monitored);

describe("episode sync monitoring", () => {
  beforeEach(() => {
    created.length = 0;
    known = [];
    monitorNewSeasons = true;
  });

  it("monitors a season the show did not have when monitorNewSeasons is on", async () => {
    await run();
    expect(monitoredOf(2)).toEqual([true, true]);
  });

  it("leaves a new season unmonitored when monitorNewSeasons is off", async () => {
    monitorNewSeasons = false;
    known = [{ season: 1, monitored: true }];
    await run();
    expect(monitoredOf(2)).toEqual([false, false]);
  });

  it("new episodes of a season with a monitored episode are monitored, even with new seasons off", async () => {
    monitorNewSeasons = false;
    known = [{ season: 1, monitored: true }];
    await run();
    expect(monitoredOf(1)).toEqual([true, true]);
  });

  it("new episodes of a fully unmonitored season stay unmonitored", async () => {
    known = [
      { season: 1, monitored: false },
      { season: 1, monitored: false },
    ];
    await run();
    expect(monitoredOf(1)).toEqual([false, false]);
  });

  it("skips specials", async () => {
    await run();
    expect(monitoredOf(0)).toEqual([]);
  });
});
