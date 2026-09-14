import { beforeEach, describe, expect, it, mock } from "bun:test";

const upsert = mock(async (_args: unknown): Promise<unknown> => ({}));
const queryRaw = mock(async () => [{ id: 1, tmdbId: 238, type: "movie" }]);

mock.module("@rawkoon/api/db", () => ({
  prisma: { libraryMediaTitle: { upsert }, $queryRaw: queryRaw },
}));

const { writeLocalizedTitles, findMediaNeedingLocalizedTitles } = await import(
  "@rawkoon/api/services/localizedTitleSync"
);

type UpsertArg = {
  where: { mediaId_language: { mediaId: number; language: string } };
  create: { mediaId: number; title: string; sortTitle: string };
  update: { title: string; sortTitle: string };
};

describe("writeLocalizedTitles", () => {
  beforeEach(() => {
    upsert.mockClear();
  });

  it("upserts one row per supported language", async () => {
    await writeLocalizedTitles(7, {
      englishTitle: "The Godfather",
      originalTitle: "The Godfather",
      originalLanguage: "en",
      translations: [{ language_code: "fr", title: "Le Parrain" }],
    });

    expect(upsert).toHaveBeenCalledTimes(2);
    const args = upsert.mock.calls.map(([arg]) => arg as unknown as UpsertArg);
    const fr = args.find(
      (a) => a.where.mediaId_language.language === "fr",
    ) as UpsertArg;
    expect(fr.create.mediaId).toBe(7);
    expect(fr.create.title).toBe("Le Parrain");
    expect(fr.create.sortTitle).toBe("Parrain");
    expect(fr.update.title).toBe("Le Parrain");
  });

  it("swallows database errors so the caller still succeeds", async () => {
    upsert.mockImplementationOnce(async () => {
      throw new Error("db down");
    });
    await expect(
      writeLocalizedTitles(7, {
        englishTitle: "Heat",
        originalTitle: "Heat",
        originalLanguage: "en",
        translations: [],
      }),
    ).resolves.toBeUndefined();
  });
});

describe("findMediaNeedingLocalizedTitles", () => {
  beforeEach(() => {
    queryRaw.mockClear();
  });

  it("returns the rows the query selects", async () => {
    const rows = await findMediaNeedingLocalizedTitles(50);
    expect(rows).toEqual([{ id: 1, tmdbId: 238, type: "movie" }]);
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });
});
