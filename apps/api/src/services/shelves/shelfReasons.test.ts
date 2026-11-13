import { describe, expect, it } from "bun:test";
import { excludedReasons, matchReasons } from "./shelfReasons";

const names: Record<string, string> = {
  "genre:27": "Horror",
  "genre:35": "Comedy",
  "keyword:207317": "christmas",
  "keyword:11931": "spoof",
  "company:3": "Pixar",
};
const nameOf = (kind: string, id: number) =>
  names[`${kind}:${id}`] ?? String(id);

const facts = {
  genre_ids: [27, 18],
  keyword_ids: [207317],
  company_ids: [3],
  network_ids: [],
  tmdb_collection_id: null,
  certification: "R",
  vote_count: 900,
  vote_average: 7.1,
};

describe("rule reasons", () => {
  it("lists only the any-ids the title has, then the none rules", () => {
    expect(
      matchReasons(
        {
          genres_any: [27, 99],
          keywords_any: [207317, 5],
          genres_none: [35],
          keywords_none: [11931],
        },
        facts,
        nameOf,
      ),
    ).toEqual([
      "Horror",
      "keyword: christmas",
      "not Comedy",
      "not keyword: spoof",
    ]);
  });

  it("describes companies, ratings and thresholds", () => {
    expect(
      matchReasons(
        { companies_any: [3], certifications: ["R"], votes_min: 300 },
        facts,
        nameOf,
      ),
    ).toEqual(["company: Pixar", "rated R", "votes ≥ 300"]);
  });

  it("names the none rules that removed a title", () => {
    expect(
      excludedReasons(
        { genres_none: [27, 35], keywords_none: [207317] },
        facts,
        nameOf,
      ),
    ).toEqual(["excluded: Horror", "excluded: keyword: christmas"]);
  });
});
