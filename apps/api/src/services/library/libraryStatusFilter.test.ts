import { describe, expect, it } from "bun:test";

import { airingStateSql, airingStateWhere } from "./libraryStatusFilter";

const text = (s: { strings: readonly string[] }) => s.strings.join("?");

describe("airingStateWhere", () => {
  it.each([
    ["returning", ["Returning Series"]],
    ["in_production", ["In Production"]],
    ["planned", ["Planned"]],
    ["ended", ["Ended", "Canceled"]],
  ] as const)("%s means a show whose TMDB status is in %p", (state, tmdb) => {
    expect(airingStateWhere(state)).toEqual({
      type: "show",
      tmdbStatus: { in: [...tmdb] },
    });
  });
});

describe("SQL twins", () => {
  it("airingStateSql matches shows on the TMDB statuses", () => {
    const q = airingStateSql("m.", "ended");
    expect(text(q)).toContain(`m."type" = 'show'`);
    expect(text(q)).toContain('m."tmdb_status" IN');
    expect(q.values).toEqual(["Ended", "Canceled"]);
  });
});
