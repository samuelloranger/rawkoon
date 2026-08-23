import { describe, it, expect } from "bun:test";
import { mapSettings } from "@rawkoon/api/routes/library/libraryMediaAdmin";

/**
 * The row shape `mapSettings` accepts is an inline structural type, so the
 * fixtures below fill only what each assertion reads and cast the rest away.
 */
const row = (over: Record<string, unknown>) =>
  ({
    moviesLibraryPath: null,
    showsLibraryPath: null,
    downloadsPath: null,
    fileOperation: "hardlink",
    movieTemplate: "",
    episodeTemplate: "",
    minSeedRatio: 0,
    postProcessingEnabled: false,
    updatedAt: new Date("2026-08-24T00:00:00Z"),
    ...over,
  }) as never;

describe("mapSettings", () => {
  it("exposes the audiobookshelf deep-link settings", () => {
    const mapped = mapSettings(
      row({
        audiobookshelfUrl: "https://audiobookshelf.samlo.cloud",
        audiobookshelfAudiobookLibraryId:
          "5bd62c95-771f-4bc2-9b05-b8ccd54a1507",
        audiobookshelfEbookLibraryId: "385e7f72-8c57-4c0e-9a31-fe0ae68a99b0",
      }),
    );

    expect(mapped.audiobookshelf_url).toBe(
      "https://audiobookshelf.samlo.cloud",
    );
    expect(mapped.audiobookshelf_audiobook_library_id).toBe(
      "5bd62c95-771f-4bc2-9b05-b8ccd54a1507",
    );
    expect(mapped.audiobookshelf_ebook_library_id).toBe(
      "385e7f72-8c57-4c0e-9a31-fe0ae68a99b0",
    );
  });

  it("reports an unconfigured instance as null", () => {
    const mapped = mapSettings(
      row({
        audiobookshelfUrl: null,
        audiobookshelfAudiobookLibraryId: null,
        audiobookshelfEbookLibraryId: null,
      }),
    );

    expect(mapped.audiobookshelf_url).toBeNull();
    expect(mapped.audiobookshelf_audiobook_library_id).toBeNull();
    expect(mapped.audiobookshelf_ebook_library_id).toBeNull();
  });
});
