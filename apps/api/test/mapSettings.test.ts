import { describe, it, expect } from "bun:test";
import { mapSettings } from "@rawkoon/api/routes/library/libraryMediaAdmin";

const row = (over: Record<string, unknown> = {}) =>
  ({
    moviesLibraryPath: null,
    showsLibraryPath: null,
    downloadsPath: null,
    booksLibraryPath: "/books",
    fileOperation: "hardlink",
    movieTemplate: "",
    episodeTemplate: "",
    minSeedRatio: 0,
    postProcessingEnabled: false,
    updatedAt: new Date("2026-08-24T00:00:00Z"),
    ...over,
  }) as never;

describe("mapSettings", () => {
  it("still maps book library paths and does not emit removed deep-link keys", () => {
    const mapped = mapSettings(row());
    expect(mapped.books_library_path).toBe("/books");
    expect(mapped.audiobooks_library_path ?? null).toBeNull();
    expect(Object.keys(mapped).some((k) => k.includes("shelf"))).toBe(false);
  });

  it("maps the seeding and download-safety settings", () => {
    const mapped = mapSettings(
      row({
        publicSeedTimeMins: null,
        privateSeedRatio: 1,
        privateSeedTimeMins: 4320,
        seedSweepEnabled: false,
        blockedExtensions: ["exe", "lnk"],
      }),
    );
    expect(mapped).toMatchObject({
      public_seed_time_mins: null,
      private_seed_ratio: 1,
      private_seed_time_mins: 4320,
      seed_sweep_enabled: false,
      blocked_extensions: ["exe", "lnk"],
    });
  });
});
