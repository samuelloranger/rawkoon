import { describe, expect, it } from "bun:test";

import {
  libraryStatusSql,
  libraryStatusWhere,
  notAiringSql,
  presentedStatusSql,
} from "./libraryStatusFilter";

const text = (s: { strings: readonly string[] }) => s.strings.join("?");

describe("libraryStatusWhere", () => {
  it.each([
    ["returning", "Returning Series"],
    ["in_production", "In Production"],
    ["planned", "Planned"],
  ])("%s means a downloaded show whose TMDB status is %s", (status, tmdb) => {
    expect(libraryStatusWhere(status)).toEqual({
      status: "downloaded",
      type: "show",
      tmdbStatus: tmdb,
    });
  });

  it("narrows downloaded to rows that are not airing, nulls included", () => {
    expect(libraryStatusWhere("downloaded")).toEqual({
      AND: [
        { status: "downloaded" },
        {
          OR: [
            { type: { not: "show" } },
            { tmdbStatus: null },
            {
              tmdbStatus: {
                notIn: ["Returning Series", "In Production", "Planned"],
              },
            },
          ],
        },
      ],
    });
  });

  it.each(["wanted", "downloading", "upgrading", "skipped", "bogus"])(
    "filters %s on the stored column",
    (status) => {
      expect(libraryStatusWhere(status)).toEqual({ status });
    },
  );
});

describe("libraryStatusSql", () => {
  it("matches a composite value on status, type and TMDB status", () => {
    const q = libraryStatusSql("m.", "returning");
    expect(text(q)).toContain('m."status"');
    expect(text(q)).toContain('m."type"');
    expect(text(q)).toContain('m."tmdb_status"');
    expect(q.values).toEqual(["downloaded", "Returning Series"]);
  });

  it("excludes airing shows for plain downloaded and keeps null TMDB status", () => {
    const q = libraryStatusSql("m.", "downloaded");
    expect(text(q)).toContain('m."tmdb_status" IS NULL');
    expect(text(q)).toContain("NOT IN");
    expect(q.values).toEqual([
      "downloaded",
      "Returning Series",
      "In Production",
      "Planned",
    ]);
  });

  it("compares other statuses directly", () => {
    const q = libraryStatusSql("m.", "wanted");
    expect(text(q)).toBe('m."status" = ?');
    expect(q.values).toEqual(["wanted"]);
  });
});

describe("notAiringSql and presentedStatusSql", () => {
  it("omit the prefix when no alias is given", () => {
    expect(text(notAiringSql())).toContain('"tmdb_status" IS NULL');
    expect(text(notAiringSql())).not.toContain("m.");
  });

  it("orders by the wire value, folding airing shows out of downloaded", () => {
    const sql = text(presentedStatusSql("m."));
    expect(sql).toContain("'returning'");
    expect(sql).toContain("'in_production'");
    expect(sql).toContain("'planned'");
  });
});
