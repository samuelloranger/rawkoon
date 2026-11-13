import { describe, expect, it, mock } from "bun:test";

mock.module("@rawkoon/api/db", () => ({ prisma: {} }));

const { hasRules, rulesWhere } = await import("./shelfRules");

const where = (rules: Parameters<typeof rulesWhere>[0], mode?: "excluded") => {
  const query = rulesWhere(rules, mode);
  return { sql: query.text, values: query.values };
};

describe("rules to SQL", () => {
  it("treats blank rules as no rules", () => {
    expect(hasRules(null)).toBe(false);
    expect(hasRules({})).toBe(false);
    expect(hasRules({ genres_any: [] })).toBe(false);
    expect(hasRules({ genres_any: [27] })).toBe(true);
    expect(hasRules({ votes_min: 0 })).toBe(true);
  });

  it("requires fetched facts and binds every value as a parameter", () => {
    const out = where({ genres_any: [27, 9648] });
    expect(out.sql).toBe(
      "facts_fetched_at IS NOT NULL AND genre_ids && $1::int[]",
    );
    expect(out.values).toEqual([[27, 9648]]);
  });

  it("maps each field to its column", () => {
    const cases: Array<[Parameters<typeof rulesWhere>[0], string, unknown[]]> =
      [
        [{ types: ["show"] }, "type = ANY($1)", [["show"]]],
        [{ keywords_any: [1] }, "keyword_ids && $1::int[]", [[1]]],
        [{ companies_any: [3] }, "company_ids && $1::int[]", [[3]]],
        [{ networks_any: [49] }, "network_ids && $1::int[]", [[49]]],
        [{ tmdb_collection: 645 }, "tmdb_collection_id = $1", [645]],
        [{ year_min: 1990 }, "year >= $1", [1990]],
        [{ year_max: 1999 }, "year <= $1", [1999]],
        [{ votes_min: 300 }, "vote_count >= $1", [300]],
        [{ rating_min: 7.5 }, "vote_average >= $1", [7.5]],
        [
          { certifications: ["G", "PG"] },
          "upper(certification) = ANY($1)",
          [["G", "PG"]],
        ],
      ];
    for (const [rules, fragment, values] of cases) {
      const out = where(rules);
      expect(out.sql).toBe(`facts_fetched_at IS NOT NULL AND ${fragment}`);
      expect(out.values).toEqual(values);
    }
  });

  it("negates the none rules for matches and selects them for the excluded list", () => {
    const rules = { genres_any: [27], genres_none: [35], keywords_none: [9] };
    const matches = where(rules);
    expect(matches.sql).toBe(
      "facts_fetched_at IS NOT NULL AND genre_ids && $1::int[] AND NOT (genre_ids && $2::int[]) AND NOT (keyword_ids && $3::int[])",
    );
    expect(matches.values).toEqual([[27], [35], [9]]);
    const excluded = where(rules, "excluded");
    expect(excluded.sql).toBe(
      "facts_fetched_at IS NOT NULL AND genre_ids && $1::int[] AND (genre_ids && $2::int[] OR keyword_ids && $3::int[])",
    );
  });

  it("never selects an excluded title when no none rule exists", () => {
    expect(where({ genres_any: [27] }, "excluded").sql).toContain("FALSE");
  });

  it("does not splice user input into the SQL text", () => {
    const out = where({ certifications: ["G'; DROP TABLE x;--"] });
    expect(out.sql).not.toContain("DROP");
    expect(out.values).toEqual([["G'; DROP TABLE X;--"]]);
  });
});
