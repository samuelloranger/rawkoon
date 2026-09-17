import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mapNytList } from "@rawkoon/api/services/books/nytBooksSource";

const payload = JSON.parse(
  readFileSync(
    join(import.meta.dir, "__fixtures__", "nyt-fiction.json"),
    "utf-8",
  ),
);

describe("mapNytList", () => {
  it("maps NYT books to ranked entries with source-supplied fields", () => {
    const entries = mapNytList(payload);
    expect(entries.length).toBe(3);
    expect(entries[0].rank).toBe(1);
    expect(entries[0].isbn13).toMatch(/^\d{13}$/);
    expect(entries[0].coverUrl).toContain("http");
    expect(entries[0].author).toBeTruthy();
    expect(entries[0].overview).toBeTruthy();
    const ranks = entries.map((e) => e.rank);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  it("returns empty for a malformed payload", () => {
    expect(mapNytList({})).toEqual([]);
    expect(mapNytList(null)).toEqual([]);
  });
});
