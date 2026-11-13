import { Prisma } from "@prisma/client";
import type { ShelfRules } from "@rawkoon/shared/types";
import { prisma } from "@rawkoon/api/db";

/** Rules with nothing to select on match nothing, so a blank shelf never swallows the library. */
export function hasRules(rules: ShelfRules | null | undefined): boolean {
  if (!rules) return false;
  return Object.values(rules).some((value) =>
    Array.isArray(value) ? value.length > 0 : value != null,
  );
}

const overlaps = (column: string, ids: number[]) =>
  Prisma.sql`${Prisma.raw(column)} && ${ids}::int[]`;

/** The "must match" conditions: everything but the `*_none` exclusions. */
function includeConditions(rules: ShelfRules): Prisma.Sql[] {
  const c: Prisma.Sql[] = [];
  const any = (column: string, ids?: number[]) => {
    if (ids?.length) c.push(overlaps(column, ids));
  };
  if (rules.types?.length) c.push(Prisma.sql`type = ANY(${rules.types})`);
  any("genre_ids", rules.genres_any);
  any("keyword_ids", rules.keywords_any);
  any("company_ids", rules.companies_any);
  any("network_ids", rules.networks_any);
  if (rules.tmdb_collection != null) {
    c.push(Prisma.sql`tmdb_collection_id = ${rules.tmdb_collection}`);
  }
  if (rules.year_min != null) c.push(Prisma.sql`year >= ${rules.year_min}`);
  if (rules.year_max != null) c.push(Prisma.sql`year <= ${rules.year_max}`);
  if (rules.votes_min != null) {
    c.push(Prisma.sql`vote_count >= ${rules.votes_min}`);
  }
  if (rules.rating_min != null) {
    c.push(Prisma.sql`vote_average >= ${rules.rating_min}`);
  }
  if (rules.certifications?.length) {
    c.push(Prisma.sql`certification = ANY(${rules.certifications})`);
  }
  return c;
}

/** The exclusion tests, any one of which removes a title. */
function excludeConditions(rules: ShelfRules): Prisma.Sql[] {
  const c: Prisma.Sql[] = [];
  if (rules.genres_none?.length) {
    c.push(overlaps("genre_ids", rules.genres_none));
  }
  if (rules.keywords_none?.length) {
    c.push(overlaps("keyword_ids", rules.keywords_none));
  }
  return c;
}

const and = (parts: Prisma.Sql[]) => Prisma.join(parts, " AND ");

/**
 * WHERE for the titles the rules select. Titles whose facts haven't been fetched
 * never match: their empty arrays would otherwise pass every `*_none` rule.
 */
export function rulesWhere(
  rules: ShelfRules,
  mode: "matches" | "excluded" = "matches",
): Prisma.Sql {
  const parts = [
    Prisma.sql`facts_fetched_at IS NOT NULL`,
    ...includeConditions(rules),
  ];
  const none = excludeConditions(rules);
  if (mode === "matches") {
    parts.push(...none.map((cond) => Prisma.sql`NOT (${cond})`));
  } else {
    // An excluded title passes every include rule but trips an exclusion
    parts.push(
      none.length
        ? Prisma.sql`(${Prisma.join(none, " OR ")})`
        : Prisma.sql`FALSE`,
    );
  }
  return and(parts);
}

export interface RuleMatchRow {
  id: number;
  tmdb_id: number;
  type: string;
  title: string;
  year: number | null;
  poster_url: string | null;
  overrides: unknown;
  genre_ids: number[];
  keyword_ids: number[];
  company_ids: number[];
  network_ids: number[];
  tmdb_collection_id: number | null;
  certification: string | null;
  vote_count: number | null;
  vote_average: number | null;
}

/** Library titles the rules select (or, for `excluded`, that a `*_none` rule removed), best-known first. */
export async function findRuleTitles(
  rules: ShelfRules,
  mode: "matches" | "excluded",
  limit?: number,
): Promise<RuleMatchRow[]> {
  if (!hasRules(rules)) return [];
  const cap = limit != null ? Prisma.sql`LIMIT ${limit}` : Prisma.empty;
  return prisma.$queryRaw<RuleMatchRow[]>(Prisma.sql`
    SELECT id, tmdb_id, type, title, year, poster_url, overrides, genre_ids,
           keyword_ids, company_ids, network_ids, tmdb_collection_id,
           certification, vote_count, vote_average
    FROM library_media
    WHERE ${rulesWhere(rules, mode)}
    ORDER BY vote_count DESC NULLS LAST, id
    ${cap}
  `);
}
