import { describe, expect, it, mock, beforeEach } from "bun:test";

const resolveIsbn = mock(async (isbn: string) =>
  isbn === "9780000000001"
    ? {
        volumeId: "vol-1",
        title: "T",
        subtitle: null,
        authors: ["Enriched Author"],
        language: "en",
        publishedYear: 2020,
        isbn13: isbn,
        coverUrl: null,
        overview: "Enriched overview",
        seriesName: null,
        seriesPosition: null,
      }
    : null,
);

mock.module("@rawkoon/api/services/books", () => ({
  getBookMetadataProvider: async () => ({ resolveIsbn }),
}));
mock.module("@rawkoon/api/db", () => ({
  prisma: {
    libraryBook: {
      findMany: async () => [{ isbn13: "9780000000001" }],
    },
  },
}));
mock.module("@rawkoon/api/services/cache", () => ({
  getJsonCache: async () => null,
  setJsonCache: async () => {},
}));
mock.module("@rawkoon/api/services/books/discoverySources", () => ({
  getDiscoverySource: (id: string) =>
    id === "test"
      ? {
          id: "leslibraires",
          label: "Test",
          isConfigured: async () => true,
          lists: async () => [{ id: "l", label: "L" }],
          fetch: async () => [
            {
              rank: 1,
              title: "A",
              isbn13: "9780000000001",
              coverUrl: "c1",
              sourceUrl: "u1",
              author: null,
              overview: null,
            },
            {
              rank: 2,
              title: "B",
              isbn13: "9780000000002",
              coverUrl: "c2",
              sourceUrl: "u2",
              author: "NYT Author",
              overview: "NYT overview",
            },
          ],
        }
      : null,
  listDiscoverySources: () => [],
}));

const { getDiscovery } = await import(
  "@rawkoon/api/services/books/bookDiscovery"
);

beforeEach(() => resolveIsbn.mockClear());

describe("getDiscovery", () => {
  it("enriches by ISBN, keeps source fields, and flags library membership", async () => {
    const res = await getDiscovery("test", "l");
    expect(res.items.length).toBe(2);
    // Entry 1: enrichment fills author/overview/volumeId; in the library.
    expect(res.items[0].author).toBe("Enriched Author");
    expect(res.items[0].volumeId).toBe("vol-1");
    expect(res.items[0].alreadyInLibrary).toBe(true);
    // Entry 2: resolveIsbn null → source fields kept, not in library.
    expect(res.items[1].author).toBe("NYT Author");
    expect(res.items[1].volumeId).toBeNull();
    expect(res.items[1].alreadyInLibrary).toBe(false);
  });

  it("prefers source-supplied author over enrichment", async () => {
    const res = await getDiscovery("test", "l");
    expect(res.items[1].author).toBe("NYT Author");
  });
});
