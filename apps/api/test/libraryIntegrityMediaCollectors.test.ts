import { describe, it, expect, mock } from "bun:test";

// A show that is still airing on TMDB can be fully downloaded; the health page
// must flag it like any other downloaded title that has no files.

const seenWheres: unknown[] = [];
const emptyPage = () => Promise.resolve([]);

mock.module("@rawkoon/api/db", () => ({
  prisma: {
    appSettings: { findUnique: () => Promise.resolve({ booksEnabled: false }) },
    integration: { findFirst: () => Promise.resolve(null) },
    libraryMedia: {
      findMany: (args: {
        cursor?: unknown;
        where?: unknown;
        select?: { _count?: unknown };
      }) => {
        // Only the "downloaded without files" collector selects a file count.
        if (!args.select?._count || args.cursor) return emptyPage();
        seenWheres.push(args.where);
        return Promise.resolve([
          {
            id: 1,
            tmdbId: 10,
            type: "show",
            title: "Airing show",
            _count: { files: 0 },
          },
        ]);
      },
    },
    libraryEpisode: { findMany: emptyPage },
    mediaFile: { findMany: emptyPage },
    bookEdition: { findMany: emptyPage },
    bookFile: { findMany: emptyPage },
  },
}));

const { collectLibraryIntegrityIssues } = await import(
  "@rawkoon/api/services/libraryIntegrity/libraryIntegrityCollectors"
);

describe("downloaded media without files", () => {
  it("selects every downloaded item, with no airing exclusion", async () => {
    const { issues } = await collectLibraryIntegrityIssues();
    expect(seenWheres).toEqual([{ status: "downloaded" }]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      kind: "downloaded_media_without_files",
      media_id: 1,
    });
  });
});
