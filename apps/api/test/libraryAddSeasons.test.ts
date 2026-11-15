import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";

// Profile and season options on POST /api/library, the manage-seasons PATCH, and the new settings.
const realTmdb = { ...(await import("@rawkoon/api/services/libraryFromTmdb")) };
const realQueue = { ...(await import("@rawkoon/api/services/queueService")) };
const realCache = { ...(await import("@rawkoon/api/services/cache")) };
const realRegion = {
  ...(await import("@rawkoon/api/utils/medias/tmdbRegion")),
};
const realHelpers = {
  ...(await import("@rawkoon/api/routes/library/libraryHelpers")),
};
const realAuth = { ...(await import("@rawkoon/api/middleware/hono/auth")) };
const realSearch = { ...(await import("@rawkoon/api/services/searchOnAdd")) };
const realNotify = {
  ...(await import("@rawkoon/api/services/mediaRequestNotifications")),
};

let settings: Record<string, unknown> | null;
let profileIds: number[];
let mediaType: string;
const addCalls: Array<Record<string, unknown>> = [];
const episodeUpdates: Array<{ where: unknown; data: unknown }> = [];
const mediaUpdates: unknown[] = [];
const settingsUpdates: unknown[] = [];

mock.module("@rawkoon/api/services/libraryFromTmdb", () => ({
  ...realTmdb,
  addOrUpdateLibraryFromTmdb: async (o: Record<string, unknown>) => {
    addCalls.push(o);
    return {
      id: 5,
      type: o.type,
      status: "wanted",
      monitored: true,
      digitalReleaseDate: new Date("2020-01-01"),
    };
  },
}));
mock.module("@rawkoon/api/services/searchOnAdd", () => ({
  ...realSearch,
  queueSearchOnAdd: async () => ({
    search_queued: false,
    search_skipped_reason: "setting_off",
    digital_release_date: null,
  }),
}));
mock.module("@rawkoon/api/services/queueService", () => ({
  ...realQueue,
  QUEUE_NAMES: { SCHEDULED_TASKS: "scheduled-tasks" },
  SCHEDULED_JOB_NAMES: { SEARCH_ON_ADD: "search-on-add" },
  addJob: async () => ({}),
}));
mock.module("@rawkoon/api/services/cache", () => ({
  ...realCache,
  deleteCache: async () => {},
}));
mock.module("@rawkoon/api/utils/medias/tmdbRegion", () => ({
  ...realRegion,
  getGlobalTmdbRegion: async () => "US",
}));
mock.module("@rawkoon/api/routes/library/libraryHelpers", () => ({
  ...realHelpers,
  mapLibraryMedia: (item: { id: number }) => ({ id: item.id }),
}));
mock.module("@rawkoon/api/middleware/hono/auth", () => ({
  ...realAuth,
  requireUser: async (_c: unknown, next: () => Promise<void>) => next(),
  requireAdmin: async (_c: unknown, next: () => Promise<void>) => next(),
  ensureAdmin: () => null,
}));
mock.module("@rawkoon/api/services/mediaRequestNotifications", () => ({
  ...realNotify,
  recheckRequestAvailable: async () => {},
}));
mock.module("@rawkoon/api/db", () => ({
  prisma: {
    qualityProfile: {
      findUnique: async (a: { where: { id: number } }) =>
        profileIds.includes(a.where.id) ? { id: a.where.id } : null,
    },
    mediaSettings: {
      findUnique: async () => settings,
      update: async (a: { data: Record<string, unknown> }) => {
        settingsUpdates.push(a.data);
        return { id: 1, updatedAt: new Date(), ...settings, ...a.data };
      },
    },
    libraryMedia: {
      findUnique: async () => ({ id: 5, type: mediaType }),
      update: async (a: unknown) => {
        mediaUpdates.push(a);
        return {};
      },
    },
    libraryEpisode: {
      findMany: async () => [
        { id: 1, season: 1, airDate: new Date("2020-01-01") },
        { id: 2, season: 2, airDate: new Date("2020-01-01") },
      ],
      updateMany: async (a: { where: unknown; data: unknown }) => {
        episodeUpdates.push(a);
        return { count: 1 };
      },
    },
  },
}));

const { libraryListRoutes } = await import(
  "@rawkoon/api/routes/library/libraryListRoutes"
);
const { libraryMetaRoutes } = await import(
  "@rawkoon/api/routes/library/libraryMetaRoutes"
);
const { libraryMediaAdminRoutes } = await import(
  "@rawkoon/api/routes/library/libraryMediaAdmin"
);

afterAll(() => {
  mock.module("@rawkoon/api/services/libraryFromTmdb", () => realTmdb);
  mock.module("@rawkoon/api/services/searchOnAdd", () => realSearch);
  mock.module("@rawkoon/api/services/queueService", () => realQueue);
  mock.module("@rawkoon/api/services/cache", () => realCache);
  mock.module("@rawkoon/api/utils/medias/tmdbRegion", () => realRegion);
  mock.module("@rawkoon/api/routes/library/libraryHelpers", () => realHelpers);
  mock.module("@rawkoon/api/middleware/hono/auth", () => realAuth);
  mock.module(
    "@rawkoon/api/services/mediaRequestNotifications",
    () => realNotify,
  );
});

const post = (body: Record<string, unknown>) =>
  libraryListRoutes.request("http://localhost/", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const patch = (
  routes: {
    request: (u: string, i: RequestInit) => Response | Promise<Response>;
  },
  path: string,
  body: Record<string, unknown>,
) =>
  routes.request(`http://localhost${path}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const show = { tmdb_id: 1, type: "show" };

beforeEach(() => {
  addCalls.length = 0;
  episodeUpdates.length = 0;
  mediaUpdates.length = 0;
  settingsUpdates.length = 0;
  settings = null;
  profileIds = [3];
  mediaType = "show";
});

describe("POST /api/library with an old client body", () => {
  it("adds a show with every season monitored and no explicit profile", async () => {
    expect((await post(show)).status).toBe(200);
    expect(addCalls[0]).toMatchObject({
      type: "show",
      seasonChoice: {
        choice: { seasonMode: "all" },
        monitorNewSeasons: true,
      },
    });
    expect("qualityProfileId" in addCalls[0]!).toBe(false);
  });

  it("adds a movie without any season choice", async () => {
    expect((await post({ tmdb_id: 1, type: "movie" })).status).toBe(200);
    expect(addCalls[0]!.seasonChoice).toBeUndefined();
  });
});

describe("POST /api/library with the new fields", () => {
  it("passes the profile and a picked set of seasons through", async () => {
    const res = await post({
      ...show,
      quality_profile_id: 3,
      season_mode: "pick",
      seasons: [2],
      monitor_new_seasons: false,
    });
    expect(res.status).toBe(200);
    expect(addCalls[0]).toMatchObject({
      qualityProfileId: 3,
      seasonChoice: {
        choice: { seasonMode: "pick", seasons: [2] },
        monitorNewSeasons: false,
      },
    });
  });

  it("uses the settings defaults when the season fields are absent", async () => {
    settings = { defaultSeasonMode: "latest", defaultMonitorNewSeasons: false };
    await post(show);
    expect(addCalls[0]).toMatchObject({
      seasonChoice: {
        choice: { seasonMode: "latest" },
        monitorNewSeasons: false,
      },
    });
  });

  it("forces new-season monitoring on for future", async () => {
    await post({ ...show, season_mode: "future", monitor_new_seasons: false });
    expect(addCalls[0]).toMatchObject({
      seasonChoice: { monitorNewSeasons: true },
    });
  });

  it("rejects an unknown profile, pick without seasons, seasons without pick, and season options on a movie", async () => {
    for (const body of [
      { ...show, quality_profile_id: 99 },
      { ...show, season_mode: "pick" },
      { ...show, season_mode: "pick", seasons: [] },
      { ...show, season_mode: "all", seasons: [1] },
      { tmdb_id: 1, type: "movie", season_mode: "all" },
    ]) {
      expect((await post(body)).status).toBe(400);
    }
    expect(addCalls).toHaveLength(0);
  });
});

describe("PATCH /api/library/:id/monitored-seasons", () => {
  it("re-plans episode monitoring and saves the new-season flag", async () => {
    const res = await patch(libraryMetaRoutes, "/5/monitored-seasons", {
      season_mode: "pick",
      seasons: [2],
      monitor_new_seasons: false,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ monitor_new_seasons: false });
    expect(episodeUpdates[0]).toMatchObject({ data: { monitored: true } });
    expect(JSON.stringify(episodeUpdates[0]!.where)).toContain("[2]");
    expect(episodeUpdates[1]).toMatchObject({ data: { monitored: false } });
    expect(mediaUpdates[0]).toMatchObject({
      data: { monitorNewSeasons: false },
    });
  });

  it("stores monitor_new_seasons true for future", async () => {
    await patch(libraryMetaRoutes, "/5/monitored-seasons", {
      season_mode: "future",
      monitor_new_seasons: false,
    });
    expect(mediaUpdates[0]).toMatchObject({
      data: { monitorNewSeasons: true },
    });
  });

  it("saves only the new-season flag when season_mode is absent", async () => {
    const res = await patch(libraryMetaRoutes, "/5/monitored-seasons", {
      monitor_new_seasons: false,
    });
    expect(res.status).toBe(200);
    expect(episodeUpdates).toHaveLength(0);
    expect(mediaUpdates[0]).toMatchObject({
      data: { monitorNewSeasons: false },
    });
  });

  it("rejects pick without seasons and a movie", async () => {
    const bad = await patch(libraryMetaRoutes, "/5/monitored-seasons", {
      season_mode: "pick",
      monitor_new_seasons: true,
    });
    expect(bad.status).toBe(400);
    mediaType = "movie";
    const movie = await patch(libraryMetaRoutes, "/5/monitored-seasons", {
      season_mode: "all",
      monitor_new_seasons: true,
    });
    expect(movie.status).toBe(400);
  });
});

describe("media settings for the add dialog", () => {
  const get = async () =>
    (
      (await (
        await libraryMediaAdminRoutes.request(
          "http://localhost/post-processing/settings",
        )
      ).json()) as { settings: Record<string, unknown> }
    ).settings;

  it("defaults to asking, letting requesters choose, all seasons, new seasons on", async () => {
    settings = {
      id: 1,
      fileOperation: "hardlink",
      movieTemplate: "",
      episodeTemplate: "",
      minSeedRatio: 1,
      postProcessingEnabled: false,
      updatedAt: new Date(),
    };
    expect(await get()).toMatchObject({
      ask_before_adding: true,
      requesters_choose_seasons: true,
      default_season_mode: "all",
      default_monitor_new_seasons: true,
    });
  });

  it("saves the four settings and rejects pick as a default", async () => {
    settings = {
      id: 1,
      fileOperation: "hardlink",
      movieTemplate: "",
      episodeTemplate: "",
      minSeedRatio: 1,
      postProcessingEnabled: false,
      updatedAt: new Date(),
    };
    const res = await patch(
      libraryMediaAdminRoutes,
      "/post-processing/settings",
      {
        ask_before_adding: false,
        requesters_choose_seasons: false,
        default_season_mode: "latest",
        default_monitor_new_seasons: false,
      },
    );
    expect(settingsUpdates).toEqual([
      {
        askBeforeAdding: false,
        requestersChooseSeasons: false,
        defaultSeasonMode: "latest",
        defaultMonitorNewSeasons: false,
      },
    ]);
    expect(((await res.json()) as any).settings).toMatchObject({
      ask_before_adding: false,
      default_season_mode: "latest",
    });
    const bad = await patch(
      libraryMediaAdminRoutes,
      "/post-processing/settings",
      {
        default_season_mode: "pick",
      },
    );
    expect(bad.status).toBe(400);
  });
});
