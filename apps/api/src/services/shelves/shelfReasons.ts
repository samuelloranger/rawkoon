import type { ShelfRules } from "@rawkoon/shared/types";

export type NameKind =
  | "genre"
  | "keyword"
  | "company"
  | "network"
  | "collection";
export type NameOf = (kind: NameKind, id: number) => string;

/** The facts a reason is read from; a subset of the rows rules are evaluated on. */
export interface ReasonFacts {
  genre_ids: number[];
  keyword_ids: number[];
  company_ids: number[];
  network_ids: number[];
  tmdb_collection_id: number | null;
  certification: string | null;
  vote_count: number | null;
  vote_average: number | null;
}

const hit = (have: number[], wanted?: number[]) =>
  (wanted ?? []).filter((id) => have.includes(id));

/** Plain parts for why a title matches: `["Horror", "keyword: christmas", "not Comedy"]`. */
export function matchReasons(
  rules: ShelfRules,
  facts: ReasonFacts,
  nameOf: NameOf,
): string[] {
  const parts: string[] = [];
  for (const id of hit(facts.genre_ids, rules.genres_any)) {
    parts.push(nameOf("genre", id));
  }
  for (const id of hit(facts.keyword_ids, rules.keywords_any)) {
    parts.push(`keyword: ${nameOf("keyword", id)}`);
  }
  for (const id of hit(facts.company_ids, rules.companies_any)) {
    parts.push(`company: ${nameOf("company", id)}`);
  }
  for (const id of hit(facts.network_ids, rules.networks_any)) {
    parts.push(`network: ${nameOf("network", id)}`);
  }
  if (
    rules.tmdb_collection != null &&
    facts.tmdb_collection_id === rules.tmdb_collection
  ) {
    parts.push(`collection: ${nameOf("collection", rules.tmdb_collection)}`);
  }
  if (rules.certifications?.length && facts.certification) {
    parts.push(`rated ${facts.certification}`);
  }
  if (rules.votes_min != null) parts.push(`votes ≥ ${rules.votes_min}`);
  if (rules.rating_min != null) parts.push(`rating ≥ ${rules.rating_min}`);
  if (rules.year_min != null) parts.push(`from ${rules.year_min}`);
  if (rules.year_max != null) parts.push(`until ${rules.year_max}`);
  for (const id of rules.genres_none ?? []) {
    parts.push(`not ${nameOf("genre", id)}`);
  }
  for (const id of rules.keywords_none ?? []) {
    parts.push(`not keyword: ${nameOf("keyword", id)}`);
  }
  return parts;
}

/** Which `*_none` rules removed a title, e.g. `["excluded: Comedy"]`. */
export function excludedReasons(
  rules: ShelfRules,
  facts: ReasonFacts,
  nameOf: NameOf,
): string[] {
  return [
    ...hit(facts.genre_ids, rules.genres_none).map(
      (id) => `excluded: ${nameOf("genre", id)}`,
    ),
    ...hit(facts.keyword_ids, rules.keywords_none).map(
      (id) => `excluded: keyword: ${nameOf("keyword", id)}`,
    ),
  ];
}
