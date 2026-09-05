import { afterEach, describe, expect, mock, test } from "bun:test";
import { probeChapterAtoms } from "@rawkoon/api/services/books/probeChapterAtoms";

const originalSpawn = Bun.spawn;

const stubSpawn = (out: string, code: number): void => {
  const spawn = mock(
    () =>
      ({
        stdout: new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(out));
            controller.close();
          },
        }),
        exited: Promise.resolve(code),
      }) as Bun.Subprocess,
  );
  (Bun as { spawn: typeof Bun.spawn }).spawn =
    spawn as unknown as typeof Bun.spawn;
};

afterEach(() => {
  (Bun as { spawn: typeof Bun.spawn }).spawn = originalSpawn;
});

describe("probeChapterAtoms", () => {
  test("parses embedded chapter atoms into whole-file offsets", async () => {
    stubSpawn(
      JSON.stringify({
        chapters: [
          {
            start_time: "0.000000",
            end_time: "100.500000",
            tags: { title: "Chapter 1" },
          },
          {
            start_time: "100.500000",
            end_time: "205.000000",
            tags: { title: "Chapter 2" },
          },
        ],
      }),
      0,
    );

    expect(await probeChapterAtoms("/library/book.m4b")).toEqual([
      { title: "Chapter 1", startSecs: 0, endSecs: 100.5 },
      { title: "Chapter 2", startSecs: 100.5, endSecs: 205 },
    ]);
  });

  test("defaults a missing title to an empty string", async () => {
    stubSpawn(
      JSON.stringify({
        chapters: [{ start_time: "0", end_time: "10" }],
      }),
      0,
    );

    expect(await probeChapterAtoms("/library/book.m4b")).toEqual([
      { title: "", startSecs: 0, endSecs: 10 },
    ]);
  });

  test("returns null when the container has no chapters", async () => {
    stubSpawn(JSON.stringify({ chapters: [] }), 0);
    expect(await probeChapterAtoms("/library/book.m4b")).toBeNull();
  });

  test("returns null when ffprobe exits non-zero", async () => {
    stubSpawn("", 1);
    expect(await probeChapterAtoms("/library/book.m4b")).toBeNull();
  });

  test("returns null on malformed JSON", async () => {
    stubSpawn("not json", 0);
    expect(await probeChapterAtoms("/library/book.m4b")).toBeNull();
  });

  test("returns null when a chapter has non-numeric offsets", async () => {
    stubSpawn(
      JSON.stringify({
        chapters: [{ start_time: "nope", end_time: "10" }],
      }),
      0,
    );
    expect(await probeChapterAtoms("/library/book.m4b")).toBeNull();
  });

  test("never throws for hostile inputs", async () => {
    (Bun as { spawn: typeof Bun.spawn }).spawn = originalSpawn;
    const hostileInputs = [
      "",
      "/tmp/path-with-a-newline\nin-it.m4b",
      `/tmp/${"x".repeat(3_000_000)}.m4b`,
    ];
    for (const input of hostileInputs) {
      await expect(probeChapterAtoms(input)).resolves.toBeNull();
    }
  });
});
