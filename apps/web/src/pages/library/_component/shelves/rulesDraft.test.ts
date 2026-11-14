import { describe, expect, it } from "vitest";
import {
  draftFromRules,
  emptyRulesDraft,
  rulesEqual,
  rulesFromDraft,
} from "./rulesDraft";

describe("rulesFromDraft", () => {
  it("turns an empty draft into null, not {}", () => {
    expect(rulesFromDraft(emptyRulesDraft())).toBeNull();
  });

  it("drops blank, invalid and non-positive fields", () => {
    const draft = {
      ...emptyRulesDraft(),
      yearMin: " ",
      yearMax: "abc",
      collection: "0",
      certifications: ["  ", ""],
    };
    expect(rulesFromDraft(draft)).toBeNull();
  });

  it("parses numbers and keeps only what is set", () => {
    const draft = {
      ...emptyRulesDraft(),
      genresAny: [27],
      yearMin: "1990",
      ratingMin: "6.5",
      votesMin: "100.9",
      certifications: [" PG ", "G"],
    };
    expect(rulesFromDraft(draft)).toEqual({
      genres_any: [27],
      certifications: ["PG", "G"],
      year_min: 1990,
      votes_min: 100,
      rating_min: 6.5,
    });
  });
});

describe("draftFromRules", () => {
  it("round-trips saved rules", () => {
    const rules = {
      types: ["movie" as const],
      genres_none: [35],
      keywords_any: [1, 2],
      companies_any: [3],
      networks_any: [4],
      tmdb_collection: 10,
      year_max: 2000,
    };
    expect(rulesFromDraft(draftFromRules(rules))).toEqual(rules);
  });

  it("reads null and {} as an empty draft", () => {
    expect(draftFromRules(null)).toEqual(emptyRulesDraft());
    expect(rulesFromDraft(draftFromRules({}))).toBeNull();
  });
});

describe("rulesEqual", () => {
  it("ignores key order and empty rules", () => {
    expect(
      rulesEqual({ year_min: 1, year_max: 2 }, { year_max: 2, year_min: 1 }),
    ).toBe(true);
    expect(rulesEqual({}, null)).toBe(true);
    expect(rulesEqual({ year_min: 1 }, null)).toBe(false);
  });
});
