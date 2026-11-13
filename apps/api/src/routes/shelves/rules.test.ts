import { beforeEach, describe, expect, it, mock } from "bun:test";

const lookups: string[] = [];
mock.module("@rawkoon/api/utils/medias/libraryHelpers", () => ({
  getLibraryTmdbApiKey: async () => "k",
  tmdbApiFetch: async (path: string) => {
    lookups.push(path);
    if (path === "genre/movie/list" || path === "genre/tv/list") {
      return {
        genres: [
          { id: 27, name: "Horror" },
          { id: 35, name: "Comedy" },
        ],
      };
    }
    if (path === "search/keyword")
      return { results: [{ id: 207317, name: "christmas" }] };
    if (path === "search/company")
      return { results: [{ id: 3, name: "Pixar" }] };
    if (path.startsWith("keyword/")) return { name: `kw ${path.slice(8)}` };
    return {};
  },
}));

const {
  addEntry,
  call,
  resetHarness,
  seedShelf,
  sendJson,
  session,
  state,
  tmdb,
  user,
} = await import("../../../test/helpers/shelvesHarness");
const { autoJoinShelves } = await import(
  "@rawkoon/api/services/shelves/shelfRulesService"
);

const HORROR = { genres_any: [27], genres_none: [35], votes_min: 300 };

const row = (tmdbId: number, over: Record<string, unknown> = {}) => ({
  id: tmdbId + 1000,
  tmdb_id: tmdbId,
  type: "movie",
  title: `Film ${tmdbId}`,
  year: 1990 + (tmdbId % 10),
  poster_url: `https://image.tmdb.org/t/p/w342/${tmdbId}.jpg`,
  overrides: null,
  genre_ids: [27],
  keyword_ids: [],
  company_ids: [],
  network_ids: [],
  tmdb_collection_id: null,
  certification: null,
  vote_count: 500,
  vote_average: 7,
  ...over,
});

// The excluded query is the only one without a negated condition
const answer = (matches: unknown[], excluded: unknown[] = []) => {
  state.queryRows = (sql: string) =>
    sql.includes("NOT (") ? matches : excluded;
};

beforeEach(() => {
  resetHarness();
  lookups.length = 0;
  tmdb.key = "k";
});

describe("rules on a shelf", () => {
  it("keeps the editor endpoints admin-only", async () => {
    const shelf = seedShelf({ rules: HORROR });
    session.user = { ...user };
    const calls = [
      sendJson("POST", `/${shelf.id}/preview`, { rules: HORROR }),
      call(`/${shelf.id}/seed-from-rules`, { method: "POST" }),
      call("/lookup/keywords?q=xmas"),
      call("/lookup/companies?q=pix"),
      sendJson("PATCH", `/${shelf.id}`, { rules: HORROR }),
    ];
    for (const res of await Promise.all(calls)) expect(res.status).toBe(403);
    expect(state.allSql).toHaveLength(0);
  });

  it("stores rules, allows auto-join only with rules, and drops it when they are cleared", async () => {
    const shelf = seedShelf();
    const early = await sendJson("PATCH", `/${shelf.id}`, { auto_join: true });
    expect(early.status).toBe(400);
    expect(state.shelves[0]?.autoJoin).toBe(false);

    const saved = await sendJson("PATCH", `/${shelf.id}`, {
      rules: HORROR,
      auto_join: true,
    });
    expect(saved.status).toBe(200);
    const body = (await saved.json()) as {
      shelf: { rules: unknown; auto_join: boolean };
    };
    expect(body.shelf).toMatchObject({ rules: HORROR, auto_join: true });

    const cleared = await sendJson("PATCH", `/${shelf.id}`, { rules: null });
    const clearedBody = (await cleared.json()) as {
      shelf: { rules: unknown; auto_join: boolean };
    };
    expect(clearedBody.shelf).toMatchObject({ rules: null, auto_join: false });
    expect(state.shelves[0]?.autoJoin).toBe(false);
  });

  it("rejects malformed rules", async () => {
    const shelf = seedShelf();
    for (const rules of [
      { genre: [27] },
      { genres_any: ["27"] },
      { rating_min: 11 },
      { year_min: 2000, year_max: 1990 },
    ]) {
      expect((await sendJson("PATCH", `/${shelf.id}`, { rules })).status).toBe(
        400,
      );
    }
  });

  it("shows rules to admins only", async () => {
    const shelf = seedShelf({
      rules: { ...HORROR, keywords_any: [207317] },
      autoJoin: true,
    });
    type View = {
      shelf: {
        rules: unknown;
        auto_join: boolean;
        rule_names?: Record<string, string>;
      };
    };
    const asAdmin = (await (await call(`/${shelf.id}`)).json()) as View;
    expect(asAdmin.shelf).toMatchObject({ auto_join: true });
    // The editor's chips show names, not bare ids
    expect(asAdmin.shelf.rule_names).toMatchObject({
      "genre:27": "Horror",
      "genre:35": "Comedy",
      "keyword:207317": "kw 207317",
    });
    session.user = { ...user };
    const asUser = (await (await call(`/${shelf.id}`)).json()) as View;
    expect(asUser.shelf).toMatchObject({ rules: null, auto_join: false });
    expect(asUser.shelf.rule_names).toBeUndefined();
  });
});

describe("preview", () => {
  it("returns matches with reasons, marks titles already on the shelf, and lists exclusions", async () => {
    const shelf = seedShelf();
    addEntry(shelf.id, { tmdbId: 2, type: "movie", title: "Film 2" });
    addEntry(shelf.id, {
      tmdbId: 3,
      type: "movie",
      title: "Film 3",
      excluded: true,
    });
    answer([row(1), row(2)], [row(4, { genre_ids: [27, 35] })]);

    const res = await sendJson("POST", `/${shelf.id}/preview`, {
      rules: HORROR,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      matches: Array<{
        tmdb_id: number;
        in_shelf: boolean;
        reason: string[];
        poster_url: string;
      }>;
      excluded: Array<{ tmdb_id: number; reason: string[] }>;
      truncated: boolean;
    };
    expect(body.matches.map((m) => [m.tmdb_id, m.in_shelf])).toEqual([
      [1, false],
      [2, true],
    ]);
    expect(body.matches[0]?.reason).toEqual([
      "Horror",
      "votes ≥ 300",
      "not Comedy",
    ]);
    expect(body.matches[0]?.poster_url).toContain("/1.jpg");
    expect(body.excluded).toEqual([
      expect.objectContaining({ tmdb_id: 4, reason: ["excluded: Comedy"] }),
    ]);
    expect(body.truncated).toBe(false);

    const sql = state.allSql.map((q) => q.sql).join("\n");
    expect(sql).toContain("FROM library_media");
    expect(sql).not.toContain("Horror");
    expect(state.allSql[0]?.values).toContainEqual([27]);
  });

  it("caps the lists and says so", async () => {
    const shelf = seedShelf();
    answer(Array.from({ length: 201 }, (_, i) => row(i + 1)));
    const body = (await (
      await sendJson("POST", `/${shelf.id}/preview`, { rules: HORROR })
    ).json()) as { matches: unknown[]; truncated: boolean };
    expect(body.matches).toHaveLength(200);
    expect(body.truncated).toBe(true);
  });

  it("answers 404 for an unknown shelf and nothing for empty rules", async () => {
    expect(
      (await sendJson("POST", "/99/preview", { rules: HORROR })).status,
    ).toBe(404);
    const shelf = seedShelf();
    const body = (await (
      await sendJson("POST", `/${shelf.id}/preview`, { rules: {} })
    ).json()) as { matches: unknown[] };
    expect(body.matches).toEqual([]);
    expect(state.allSql).toHaveLength(0);
  });
});

describe("seed from rules", () => {
  it("adds matches as rule entries once, skipping existing and excluded titles", async () => {
    const shelf = seedShelf({ rules: HORROR });
    addEntry(shelf.id, { tmdbId: 2, source: "manual", title: "Film 2" });
    addEntry(shelf.id, {
      tmdbId: 3,
      source: "rule",
      excluded: true,
      title: "Film 3",
    });
    state.media.push({
      id: 1001,
      tmdbId: 1,
      type: "movie",
      title: "Film 1",
      year: 1991,
      posterUrl: null,
      overrides: null,
      genreIds: [27],
    });
    answer([row(1), row(2), row(3)]);

    const res = await call(`/${shelf.id}/seed-from-rules`, { method: "POST" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      shelf: {
        entries: Array<{
          tmdb_id: number;
          source: string;
          reason: string[] | null;
        }>;
      };
    };
    const added = state.entries.filter(
      (e) => e.source === "rule" && !e.excluded,
    );
    expect(added.map((e) => e.tmdbId)).toEqual([1]);
    expect(state.entries.find((e) => e.tmdbId === 2)?.source).toBe("manual");
    expect(state.entries.find((e) => e.tmdbId === 3)?.excluded).toBe(true);
    const first = body.shelf.entries.find((e) => e.tmdb_id === 1);
    expect(first?.reason).toEqual(["Horror", "votes ≥ 300", "not Comedy"]);
    expect(body.shelf.entries.find((e) => e.tmdb_id === 2)?.reason).toBeNull();

    await call(`/${shelf.id}/seed-from-rules`, { method: "POST" });
    expect(state.entries).toHaveLength(3);
  });

  it("skips a show the shelf already holds as a season", async () => {
    const shelf = seedShelf({ rules: HORROR });
    addEntry(shelf.id, {
      tmdbId: 5,
      type: "show",
      season: 2,
      source: "manual",
      title: "Show 5",
    });
    answer([row(5, { type: "show" })]);
    await call(`/${shelf.id}/seed-from-rules`, { method: "POST" });
    expect(state.entries).toHaveLength(1);
  });

  it("refuses rules on create, where they would be dropped", async () => {
    const res = await sendJson("POST", "/", { name: "X", rules: HORROR });
    expect(res.status).toBe(400);
  });

  it("refuses a shelf with no rules", async () => {
    const shelf = seedShelf();
    expect(
      (await call(`/${shelf.id}/seed-from-rules`, { method: "POST" })).status,
    ).toBe(400);
    expect((await call("/99/seed-from-rules", { method: "POST" })).status).toBe(
      404,
    );
  });

  it("hides the reasons from non-admins", async () => {
    const shelf = seedShelf({ rules: HORROR });
    addEntry(shelf.id, { tmdbId: 1, source: "rule" });
    session.user = { ...user };
    const body = (await (await call(`/${shelf.id}`)).json()) as {
      shelf: { entries: Array<{ reason: string[] | null }> };
    };
    expect(body.shelf.entries[0]?.reason).toBeNull();
  });
});

describe("auto-join", () => {
  it("adds new matches, never re-adds an excluded title, never touches manual entries", async () => {
    const shelf = seedShelf({ rules: HORROR, autoJoin: true });
    addEntry(shelf.id, {
      tmdbId: 2,
      source: "manual",
      title: "Film 2",
      position: 0,
    });
    addEntry(shelf.id, {
      tmdbId: 3,
      source: "rule",
      excluded: true,
      title: "Film 3",
      position: 1,
    });
    answer([row(1), row(2), row(3), row(5)]);

    expect(await autoJoinShelves()).toEqual({ shelves: 1, added: 2 });
    expect(
      state.entries
        .filter((e) => e.source === "rule" && !e.excluded)
        .map((e) => e.tmdbId),
    ).toEqual([1, 5]);
    expect(state.entries.find((e) => e.tmdbId === 2)).toMatchObject({
      source: "manual",
      excluded: false,
    });
    expect(state.entries.find((e) => e.tmdbId === 3)?.excluded).toBe(true);
    expect(state.entries).toHaveLength(4);

    expect(await autoJoinShelves()).toEqual({ shelves: 1, added: 0 });
  });

  it("leaves shelves without the switch, or without rules, alone", async () => {
    seedShelf({ rules: HORROR, autoJoin: false });
    seedShelf({ rules: null, autoJoin: true });
    answer([row(1)]);
    expect(await autoJoinShelves()).toEqual({ shelves: 0, added: 0 });
    expect(state.entries).toHaveLength(0);
    expect(state.allSql).toHaveLength(0);
  });
});

describe("rating order", () => {
  it("sorts by vote average, with unrated titles after in release order", async () => {
    const shelf = seedShelf({ orderMode: "rating" });
    for (const [tmdbId, year] of [
      [1, 2000],
      [2, 1990],
      [3, 1980],
      [4, 1970],
    ] as const) {
      addEntry(shelf.id, { tmdbId, year, title: `Film ${tmdbId}` });
    }
    const media = (tmdbId: number, voteAverage: number | null) =>
      state.media.push({
        id: tmdbId,
        tmdbId,
        type: "movie",
        title: `Film ${tmdbId}`,
        year: 2000,
        posterUrl: null,
        overrides: null,
        voteAverage,
      });
    media(1, 6.1);
    media(2, 8.4);
    media(3, null);
    // Film 4 is not in the library at all
    const body = (await (await call(`/${shelf.id}`)).json()) as {
      shelf: { entries: Array<{ tmdb_id: number }> };
    };
    expect(body.shelf.entries.map((e) => e.tmdb_id)).toEqual([2, 1, 4, 3]);
  });
});

describe("lookups", () => {
  it("proxies TMDB keyword and company search and caches by query", async () => {
    const kw = (await (await call("/lookup/keywords?q=Christmas")).json()) as {
      items: unknown[];
    };
    expect(kw.items).toEqual([{ id: 207317, name: "christmas" }]);
    await call("/lookup/keywords?q=christmas");
    expect(lookups.filter((p) => p === "search/keyword")).toHaveLength(1);

    const co = (await (await call("/lookup/companies?q=pix")).json()) as {
      items: unknown[];
    };
    expect(co.items).toEqual([{ id: 3, name: "Pixar" }]);
  });

  it("returns an empty list for a blank query and 404 for another kind", async () => {
    const blank = (await (await call("/lookup/keywords")).json()) as {
      items: unknown[];
    };
    expect(blank.items).toEqual([]);
    expect((await call("/lookup/networks?q=x")).status).toBe(404);
  });
});

describe("seeding a shelf from the Real horror seed", () => {
  it("creates it with rules, auto-join off, and fills it from existing facts", async () => {
    answer([row(1), row(2)]);
    const res = await sendJson("POST", "/", { seed: "real_horror" });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      shelf: {
        rules: { votes_min: number };
        auto_join: boolean;
        entries: unknown[];
        order_mode: string;
      };
    };
    expect(body.shelf.rules.votes_min).toBe(300);
    expect(body.shelf.auto_join).toBe(false);
    expect(body.shelf.order_mode).toBe("rating");
    expect(body.shelf.entries).toHaveLength(2);
  });

  it("creates it empty when no facts exist, and creates Cozy Sunday empty", async () => {
    const horror = await sendJson("POST", "/", { seed: "real_horror" });
    expect(horror.status).toBe(201);
    const cozy = await sendJson("POST", "/", { seed: "cozy_sunday" });
    expect(cozy.status).toBe(201);
    expect(state.entries).toHaveLength(0);
    expect(state.shelves.map((s) => s.name)).toEqual([
      "Real horror",
      "Cozy Sunday",
    ]);
  });
});
