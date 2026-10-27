import { describe, expect, it } from "bun:test";

import {
  airingStateSql,
  airingStateWhere,
  downloadedNotAiringWhere,
  notAiringSql,
  notAiringWhere,
} from "./libraryStatusFilter";

const text = (s: { strings: readonly string[] }) => s.strings.join("?");

describe("notAiringWhere", () => {
  it("keeps movies, null TMDB statuses and finished shows", () => {
    expect(notAiringWhere).toEqual({
      OR: [
        { type: { not: "show" } },
        { tmdbStatus: null },
        {
          tmdbStatus: {
            notIn: ["Returning Series", "In Production", "Planned"],
          },
        },
      ],
    });
  });

  it("narrows downloaded to titles that are not airing", () => {
    expect(downloadedNotAiringWhere).toEqual({
      AND: [{ status: "downloaded" }, notAiringWhere],
    });
  });
});

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

  it("notAiringSql keeps a null TMDB status and omits the prefix without an alias", () => {
    const q = notAiringSql();
    expect(text(q)).toContain('"tmdb_status" IS NULL');
    expect(text(q)).not.toContain("m.");
    expect(q.values).toEqual(["Returning Series", "In Production", "Planned"]);
  });
});
