import { describe, expect, it } from "bun:test";
import { buildLocalizedIdQuery } from "./libraryLocalizedListQuery";

const sqlText = (s: { strings: readonly string[] }) => s.strings.join("?");

describe("buildLocalizedIdQuery", () => {
  it("joins the title table on the requested language", () => {
    const q = buildLocalizedIdQuery({
      language: "fr",
      sortBy: "title",
      sortDir: "asc",
      take: 60,
      skip: 0,
    });
    const text = sqlText(q);
    expect(text).toContain("library_media_titles");
    expect(text).toContain("LEFT JOIN");
    expect(q.values).toContain("fr");
  });

  it("orders by the coalesced localized sort title for a title sort", () => {
    const q = buildLocalizedIdQuery({
      language: "fr",
      sortBy: "title",
      sortDir: "desc",
      take: 60,
      skip: 0,
    });
    const text = sqlText(q);
    expect(text).toContain('COALESCE(t.sort_title, m."list_title")');
    expect(text).toContain("DESC");
  });

  it("still uses the persisted column for a non-title sort", () => {
    const q = buildLocalizedIdQuery({
      language: "fr",
      sortBy: "added_at",
      sortDir: "desc",
      take: 60,
      skip: 0,
    });
    expect(sqlText(q)).toContain('m."added_at"');
  });

  it("searches the localized title and the English title", () => {
    const q = buildLocalizedIdQuery({
      language: "fr",
      q: "parrain",
      sortBy: "title",
      sortDir: "asc",
      take: 60,
      skip: 0,
    });
    const text = sqlText(q);
    expect(text).toContain("t.title ILIKE");
    expect(text).toContain('m."title" ILIKE');
    expect(q.values).toContain("%parrain%");
  });

  it("never inlines the search term into the SQL text", () => {
    const q = buildLocalizedIdQuery({
      language: "fr",
      q: "'; DROP TABLE library_media; --",
      sortBy: "title",
      sortDir: "asc",
      take: 60,
      skip: 0,
    });
    expect(sqlText(q)).not.toContain("DROP TABLE");
  });

  it("filters by type, status and file language when given", () => {
    const q = buildLocalizedIdQuery({
      language: "fr",
      type: "movie",
      status: "downloaded",
      fileLanguage: "fre",
      sortBy: "title",
      sortDir: "asc",
      take: 60,
      skip: 0,
    });
    expect(q.values).toContain("movie");
    expect(q.values).toContain("downloaded");
    expect(q.values).toContain("fre");
    expect(sqlText(q)).toContain("media_files");
  });

  it("paginates with limit and offset", () => {
    const q = buildLocalizedIdQuery({
      language: "fr",
      sortBy: "title",
      sortDir: "asc",
      take: 61,
      skip: 120,
    });
    expect(q.values).toContain(61);
    expect(q.values).toContain(120);
  });

  it("emits no WHERE clause when nothing is filtered", () => {
    const q = buildLocalizedIdQuery({
      language: "en",
      sortBy: "title",
      sortDir: "asc",
      take: 60,
      skip: 0,
    });
    expect(sqlText(q)).not.toContain("WHERE");
  });
});
