import type { ShelfRules } from "@rawkoon/shared/types";

/** The editor's form state: numbers stay strings so a half-typed field doesn't fight the user. */
export type RulesDraft = {
  types: ("movie" | "show")[];
  genresAny: number[];
  genresNone: number[];
  keywordsAny: number[];
  keywordsNone: number[];
  companiesAny: number[];
  networksAny: number[];
  collection: string;
  yearMin: string;
  yearMax: string;
  votesMin: string;
  ratingMin: string;
  certifications: string[];
};

export const emptyRulesDraft = (): RulesDraft => ({
  types: [],
  genresAny: [],
  genresNone: [],
  keywordsAny: [],
  keywordsNone: [],
  companiesAny: [],
  networksAny: [],
  collection: "",
  yearMin: "",
  yearMax: "",
  votesMin: "",
  ratingMin: "",
  certifications: [],
});

const text = (n: number | undefined) => (n == null ? "" : String(n));

export const draftFromRules = (rules: ShelfRules | null): RulesDraft => ({
  types: rules?.types ?? [],
  genresAny: rules?.genres_any ?? [],
  genresNone: rules?.genres_none ?? [],
  keywordsAny: rules?.keywords_any ?? [],
  keywordsNone: rules?.keywords_none ?? [],
  companiesAny: rules?.companies_any ?? [],
  networksAny: rules?.networks_any ?? [],
  collection: text(rules?.tmdb_collection),
  yearMin: text(rules?.year_min),
  yearMax: text(rules?.year_max),
  votesMin: text(rules?.votes_min),
  ratingMin: text(rules?.rating_min),
  certifications: rules?.certifications ?? [],
});

const num = (value: string, integer: boolean): number | undefined => {
  const n = Number(value.trim());
  if (value.trim() === "" || !Number.isFinite(n)) return undefined;
  return integer ? Math.trunc(n) : n;
};

/** Unset fields are dropped, and a draft with nothing set is `null` (no rules), never `{}`. */
export function rulesFromDraft(draft: RulesDraft): ShelfRules | null {
  const rules: ShelfRules = {};
  if (draft.types.length) rules.types = draft.types;
  if (draft.genresAny.length) rules.genres_any = draft.genresAny;
  if (draft.genresNone.length) rules.genres_none = draft.genresNone;
  if (draft.keywordsAny.length) rules.keywords_any = draft.keywordsAny;
  if (draft.keywordsNone.length) rules.keywords_none = draft.keywordsNone;
  if (draft.companiesAny.length) rules.companies_any = draft.companiesAny;
  if (draft.networksAny.length) rules.networks_any = draft.networksAny;
  const certifications = draft.certifications
    .map((c) => c.trim())
    .filter(Boolean);
  if (certifications.length) rules.certifications = certifications;
  const collection = num(draft.collection, true);
  if (collection != null && collection > 0) rules.tmdb_collection = collection;
  const yearMin = num(draft.yearMin, true);
  if (yearMin != null) rules.year_min = yearMin;
  const yearMax = num(draft.yearMax, true);
  if (yearMax != null) rules.year_max = yearMax;
  const votesMin = num(draft.votesMin, true);
  if (votesMin != null) rules.votes_min = votesMin;
  const ratingMin = num(draft.ratingMin, false);
  if (ratingMin != null) rules.rating_min = ratingMin;
  return Object.keys(rules).length ? rules : null;
}

/** Equal once normalised, so key order or an empty `{}` from the server doesn't read as an edit. */
export const rulesEqual = (a: ShelfRules | null, b: ShelfRules | null) =>
  JSON.stringify(rulesFromDraft(draftFromRules(a))) ===
  JSON.stringify(rulesFromDraft(draftFromRules(b)));
