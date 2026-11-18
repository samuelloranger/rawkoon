import { describe, expect, it } from "bun:test";
import { evaluateFreeSpace, evaluatePathAccess, type PathProbe } from "./paths";

const probe = (over: Partial<PathProbe> = {}): PathProbe => ({
  exists: true,
  isDirectory: true,
  readableAndWritable: true,
  error: null,
  ...over,
});

describe("evaluatePathAccess", () => {
  it("warns when the path is not configured and points at Settings", () => {
    const outcome = evaluatePathAccess(null, probe());
    expect(outcome.status).toBe("warn");
    expect(outcome.summary).toBe("Not configured.");
    expect(outcome.fix).toContain("Settings → Library");
  });

  it("warns when the path does not exist yet", () => {
    const outcome = evaluatePathAccess(
      "/data/movies",
      probe({ exists: false }),
    );
    expect(outcome.status).toBe("warn");
    expect(outcome.summary).toContain("does not exist");
  });

  it("warns when the path exists but is not a directory", () => {
    const outcome = evaluatePathAccess(
      "/data/movies",
      probe({ isDirectory: false }),
    );
    expect(outcome.status).toBe("warn");
    expect(outcome.summary).toContain("is not a directory");
  });

  it("fails when the path exists but is not readable/writable", () => {
    const outcome = evaluatePathAccess(
      "/data/movies",
      probe({ readableAndWritable: false }),
    );
    expect(outcome.status).toBe("fail");
    expect(outcome.fix).toContain("PUID/PGID");
  });

  it("fails with the cause when stat itself fails", () => {
    const outcome = evaluatePathAccess(
      "/data/movies",
      probe({ error: "the OS denied permission" }),
    );
    expect(outcome.status).toBe("fail");
    expect(outcome.summary).toContain("the OS denied permission");
  });

  it("is ok when the directory is readable and writable", () => {
    const outcome = evaluatePathAccess("/data/movies", probe());
    expect(outcome.status).toBe("ok");
    expect(outcome.summary).toContain("readable and writable");
    expect(outcome.fix).toBeNull();
  });
});

describe("evaluateFreeSpace", () => {
  const gb = (n: number) => n * 1024 ** 3;

  it("is ok when there is nothing to measure", () => {
    const outcome = evaluateFreeSpace(10, []);
    expect(outcome.status).toBe("ok");
    expect(outcome.summary).toContain("No configured path");
  });

  it("is ok when every reading clears the minimum", () => {
    const outcome = evaluateFreeSpace(10, [
      { id: "downloads_path", freeBytes: gb(120), error: null },
      { id: "library_path_movies", freeBytes: gb(45), error: null },
    ]);
    expect(outcome.status).toBe("ok");
    expect(outcome.summary).toContain("120.0 GB free");
    expect(outcome.summary).toContain("45.0 GB free");
    expect(outcome.summary).toContain("minimum 10 GB");
  });

  it("warns naming the paths below the minimum", () => {
    const outcome = evaluateFreeSpace(10, [
      { id: "downloads_path", freeBytes: gb(4.2), error: null },
      { id: "library_path_movies", freeBytes: gb(45), error: null },
    ]);
    expect(outcome.status).toBe("warn");
    expect(outcome.summary).toContain("Below the 10 GB minimum");
    expect(outcome.summary).toContain("downloads_path");
    expect(outcome.summary).not.toContain("45.0 GB free");
    expect(outcome.fix).toContain("Free up space");
  });

  it("warns when nothing could be measured, with the cause", () => {
    const outcome = evaluateFreeSpace(10, [
      {
        id: "downloads_path",
        freeBytes: null,
        error: "the OS denied permission",
      },
    ]);
    expect(outcome.status).toBe("warn");
    expect(outcome.summary).toContain("could not be measured");
    expect(outcome.summary).toContain("the OS denied permission");
  });

  it("skips the threshold when the guard is disabled (0)", () => {
    const outcome = evaluateFreeSpace(0, [
      { id: "downloads_path", freeBytes: gb(2), error: null },
    ]);
    expect(outcome.status).toBe("ok");
    expect(outcome.summary).toContain("no minimum set");
  });
});
