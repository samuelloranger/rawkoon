/**
 * buildLocalizedIdQuery is raw SQL, so only a real Postgres proves the LEFT
 * JOIN, the COALESCE ordering and the two-column ILIKE. Skips without a
 * DATABASE_URL, matching the other integration-mode suites here.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { buildLocalizedIdQuery } from "../src/routes/library/libraryLocalizedListQuery";

const hasDb = !!process.env.DATABASE_URL;

// test/preload.ts mocks ../src/db with a null-returning proxy for every suite,
// so a real connection has to be built here rather than imported.
const prisma = hasDb
  ? new PrismaClient({
      adapter: new PrismaPg({
        connectionString: process.env.DATABASE_URL as string,
      }),
    })
  : (null as unknown as PrismaClient);

const TMDB_BASE = 991_000_000;
const ids: number[] = [];

async function run(
  input: Parameters<typeof buildLocalizedIdQuery>[0],
): Promise<number[]> {
  const rows = await prisma.$queryRaw<{ id: number }[]>(
    buildLocalizedIdQuery(input),
  );
  return rows.map((r) => r.id).filter((id) => ids.includes(id));
}

describe("localized library list query", () => {
  beforeAll(async () => {
    if (!hasDb) return;
    // English A-Z: Alpha, Beta. French A-Z: the reverse.
    const fixtures = [
      { en: "Alpha Widget", fr: "Zulu Machin", frSort: "Zulu Machin" },
      { en: "Beta Widget", fr: "Le Alpha Machin", frSort: "Alpha Machin" },
    ];
    for (const [i, f] of fixtures.entries()) {
      const media = await prisma.libraryMedia.create({
        data: {
          tmdbId: TMDB_BASE + i,
          type: "movie",
          title: f.en,
          listTitle: f.en,
        },
      });
      ids.push(media.id);
      await prisma.libraryMediaTitle.createMany({
        data: [
          {
            mediaId: media.id,
            language: "en",
            title: f.en,
            sortTitle: f.en,
          },
          {
            mediaId: media.id,
            language: "fr",
            title: f.fr,
            sortTitle: f.frSort,
          },
        ],
      });
    }
  });

  afterAll(async () => {
    if (!hasDb) return;
    if (ids.length > 0) {
      await prisma.libraryMedia.deleteMany({ where: { id: { in: ids } } });
    }
    await prisma.$disconnect();
  });

  it("orders by the French sort title, reversing the English order", async () => {
    if (!hasDb) return;
    const fr = await run({
      language: "fr",
      sortBy: "title",
      sortDir: "asc",
      take: 100,
      skip: 0,
    });
    const en = await run({
      language: "en",
      sortBy: "title",
      sortDir: "asc",
      take: 100,
      skip: 0,
    });
    expect(fr).toEqual([...en].reverse());
  });

  it("finds a media by its French substring", async () => {
    if (!hasDb) return;
    const found = await run({
      language: "fr",
      q: "Zulu Machin",
      sortBy: "title",
      sortDir: "asc",
      take: 100,
      skip: 0,
    });
    expect(found).toEqual([ids[0] as number]);
  });

  it("still finds it by its English substring from a French list", async () => {
    if (!hasDb) return;
    const found = await run({
      language: "fr",
      q: "Alpha Widget",
      sortBy: "title",
      sortDir: "asc",
      take: 100,
      skip: 0,
    });
    expect(found).toEqual([ids[0] as number]);
  });

  it("falls back to the English sort column when no row exists", async () => {
    if (!hasDb) return;
    const orphan = await prisma.libraryMedia.create({
      data: {
        tmdbId: TMDB_BASE + 99,
        type: "movie",
        title: "Orphan Widget",
        listTitle: "Orphan Widget",
      },
    });
    ids.push(orphan.id);
    const found = await run({
      language: "fr",
      q: "Orphan Widget",
      sortBy: "title",
      sortDir: "asc",
      take: 100,
      skip: 0,
    });
    expect(found).toEqual([orphan.id]);
  });
});
