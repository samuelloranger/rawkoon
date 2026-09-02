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
});
