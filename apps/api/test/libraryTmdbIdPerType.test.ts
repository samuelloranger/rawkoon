import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";

// TMDB numbers movies and shows separately, so adding a movie must not touch
// a show that happens to share its TMDB id.
const realDb = { ...(await import("@rawkoon/api/db")) };
const realHelpers = {
  ...(await import("@rawkoon/api/utils/medias/libraryHelpers")),
};
const realTitles = {
  ...(await import("@rawkoon/api/services/localizedTitleSync")),
};

type Row = { id: number; tmdbId: number; type: string; title: string };
let rows: Row[] = [];

type Where = {
  tmdbId?: number;
  tmdbId_type?: { tmdbId: number; type: string };
};
// Resolves a unique lookup the way Postgres would for whichever key is used.
const find = (where: Where) =>
  rows.find((r) =>
    where.tmdbId_type
      ? r.tmdbId === where.tmdbId_type.tmdbId &&
        r.type === where.tmdbId_type.type
      : r.tmdbId === where.tmdbId,
  ) ?? null;

mock.module("@rawkoon/api/db", () => ({
  prisma: {
    mediaSettings: { findUnique: async () => null },
    qualityProfile: { findUnique: async () => null },
    libraryMedia: {
      findUnique: async (a: { where: Where }) => find(a.where),
      upsert: async (a: {
        where: Where;
        create: Omit<Row, "id">;
        update: Partial<Row>;
      }) => {
        const existing = find(a.where);
        if (existing) return Object.assign(existing, a.update);
        const row = { id: rows.length + 1, ...a.create };
        rows.push(row);
        return row;
      },
    },
  },
}));
mock.module("@rawkoon/api/utils/medias/libraryHelpers", () => ({
  ...realHelpers,
  getLibraryTmdbApiKey: async () => "key",
  tmdbDetailsFetch: async () => ({
    title: "A Movie",
    release_date: "2020-01-01",
    poster_path: null,
    overview: "",
  }),
  tmdbApiFetch: async () => ({ results: [] }),
}));
mock.module("@rawkoon/api/services/localizedTitleSync", () => ({
  ...realTitles,
  writeLocalizedTitles: async () => {},
}));

const { addOrUpdateLibraryFromTmdb } = await import(
  "@rawkoon/api/services/libraryFromTmdb"
);

afterAll(() => {
  mock.module("@rawkoon/api/db", () => realDb);
  mock.module("@rawkoon/api/utils/medias/libraryHelpers", () => realHelpers);
  mock.module("@rawkoon/api/services/localizedTitleSync", () => realTitles);
});

beforeEach(() => {
  rows = [{ id: 1, tmdbId: 42, type: "show", title: "A Show" }];
});

describe("addOrUpdateLibraryFromTmdb with a TMDB id shared by a movie and a show", () => {
  it("adds the movie as its own row and leaves the show untouched", async () => {
    const movie = await addOrUpdateLibraryFromTmdb({
      tmdb_id: 42,
      type: "movie",
      qualityProfileId: null,
    });

    expect(movie).toMatchObject({
      tmdbId: 42,
      type: "movie",
      title: "A Movie",
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      id: 1,
      tmdbId: 42,
      type: "show",
      title: "A Show",
    });
  });
});
