import { describe, expect, it } from "bun:test";
import { evaluateHardlinks } from "./hardlinks";

describe("evaluateHardlinks", () => {
  it("is ok when imports do not use hardlinks", () => {
    for (const fileOperation of ["move", "none"]) {
      const outcome = evaluateHardlinks({
        fileOperation,
        downloadsDevice: 1,
        libraryDevices: [{ id: "library_path_movies", device: 2 }],
      });
      expect(outcome.status).toBe("ok");
      expect(outcome.summary).toContain(`"${fileOperation}"`);
    }
  });

  it("is ok when not enough paths are configured to compare", () => {
    const outcome = evaluateHardlinks({
      fileOperation: "hardlink",
      downloadsDevice: null,
      libraryDevices: [{ id: "library_path_movies", device: 2 }],
    });
    expect(outcome.status).toBe("ok");

    const noLibraries = evaluateHardlinks({
      fileOperation: "hardlink",
      downloadsDevice: 1,
      libraryDevices: [],
    });
    expect(noLibraries.status).toBe("ok");
  });

  it("is ok when downloads and libraries share one filesystem", () => {
    const outcome = evaluateHardlinks({
      fileOperation: "hardlink",
      downloadsDevice: 42,
      libraryDevices: [
        { id: "library_path_movies", device: 42 },
        { id: "library_path_shows", device: 42 },
      ],
    });
    expect(outcome.status).toBe("ok");
    expect(outcome.summary).toContain("same filesystem");
  });

  it("warns naming the library paths on another device", () => {
    const outcome = evaluateHardlinks({
      fileOperation: "hardlink",
      downloadsDevice: 42,
      libraryDevices: [
        { id: "library_path_movies", device: 42 },
        { id: "library_path_shows", device: 7 },
        { id: "library_path_books", device: 7 },
      ],
    });
    expect(outcome.status).toBe("warn");
    expect(outcome.summary).toContain("library_path_shows, library_path_books");
    expect(outcome.summary).toContain("cannot cross filesystems");
    expect(outcome.fix).toContain("single parent directory");
  });
});
