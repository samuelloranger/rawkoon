import type {
  ShelfEntryView,
  ShelfMediaType,
  ShelfPreview,
  ShelfPreviewTitle,
  ShelfRules,
} from "@rawkoon/shared/types";
import { prisma } from "@rawkoon/api/db";
import { libraryArtwork, rulesOf, shelfTypeOf } from "./shelfMapping";
import {
  excludedReasons,
  matchReasons,
  type ReasonFacts,
} from "./shelfReasons";
import { loadRuleNames } from "./shelfLookups";
import { findRuleTitles, hasRules, type RuleMatchRow } from "./shelfRules";

export const PREVIEW_MATCH_LIMIT = 200;
export const PREVIEW_EXCLUDED_LIMIT = 100;

const titleKey = (type: string, tmdbId: number) => `${type}:${tmdbId}`;

const previewTitle = (
  row: RuleMatchRow,
  inShelf: Set<string>,
  reason: string[],
): ShelfPreviewTitle => {
  const art = libraryArtwork({
    id: row.id,
    title: row.title,
    year: row.year,
    posterUrl: row.poster_url,
    overrides: row.overrides,
  });
  return {
    tmdb_id: row.tmdb_id,
    type: shelfTypeOf(row.type),
    title: art.title ?? row.title,
    year: art.year,
    poster_url: art.posterUrl,
    in_shelf: inShelf.has(titleKey(row.type, row.tmdb_id)),
    reason,
  };
};

/** What the rules select now, and what a `*_none` rule removed, each with its reason. */
export async function previewRules(
  shelfId: number,
  rules: ShelfRules,
): Promise<ShelfPreview | null> {
  const shelf = await prisma.shelf.findUnique({
    where: { id: shelfId },
    select: { id: true },
  });
  if (!shelf) return null;
  const [matchRows, excludedRows, held, nameOf] = await Promise.all([
    findRuleTitles(rules, "matches", PREVIEW_MATCH_LIMIT + 1),
    findRuleTitles(rules, "excluded", PREVIEW_EXCLUDED_LIMIT + 1),
    prisma.shelfEntry.findMany({
      where: { shelfId, season: null, excluded: false },
      select: { tmdbId: true, type: true },
    }),
    hasRules(rules) ? loadRuleNames(rules) : Promise.resolve(() => ""),
  ]);
  const inShelf = new Set(held.map((e) => titleKey(e.type, e.tmdbId)));
  return {
    matches: matchRows
      .slice(0, PREVIEW_MATCH_LIMIT)
      .map((row) =>
        previewTitle(row, inShelf, matchReasons(rules, row, nameOf)),
      ),
    excluded: excludedRows
      .slice(0, PREVIEW_EXCLUDED_LIMIT)
      .map((row) =>
        previewTitle(row, inShelf, excludedReasons(rules, row, nameOf)),
      ),
    truncated:
      matchRows.length > PREVIEW_MATCH_LIMIT ||
      excludedRows.length > PREVIEW_EXCLUDED_LIMIT,
  };
}

/**
 * Add the titles the rules select as `rule` entries. A title the shelf already
 * has in any form (manual, rule, or excluded) is skipped, so an admin's removal
 * and hand-placed entries are never touched.
 */
export async function addRuleMatches(
  shelfId: number,
  rules: ShelfRules,
): Promise<number> {
  const matches = await findRuleTitles(rules, "matches");
  if (!matches.length) return 0;
  const existing = await prisma.shelfEntry.findMany({
    where: { shelfId, season: null },
    select: { tmdbId: true, type: true },
  });
  const known = new Set(existing.map((e) => titleKey(e.type, e.tmdbId)));
  const fresh = matches.filter((m) => !known.has(titleKey(m.type, m.tmdb_id)));
  if (!fresh.length) return 0;
  const last = await prisma.shelfEntry.findFirst({
    where: { shelfId },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  const start = (last?.position ?? -1) + 1;
  const created = await prisma.shelfEntry.createMany({
    data: fresh.map((row, index) => ({
      shelfId,
      tmdbId: row.tmdb_id,
      type: row.type,
      season: null,
      position: start + index,
      source: "rule",
      title: row.title,
      year: row.year,
    })),
    skipDuplicates: true,
  });
  return created.count;
}

/** The admin's one-off "Seed from rules": the current matches join the shelf once. */
export async function seedFromRules(
  shelfId: number,
): Promise<
  { ok: true; added: number } | { ok: false; reason: "not_found" | "no_rules" }
> {
  const shelf = await prisma.shelf.findUnique({
    where: { id: shelfId },
    select: { rules: true },
  });
  if (!shelf) return { ok: false, reason: "not_found" };
  const rules = rulesOf(shelf.rules);
  if (!rules || !hasRules(rules)) return { ok: false, reason: "no_rules" };
  return { ok: true, added: await addRuleMatches(shelfId, rules) };
}

/** Nightly: every auto-join shelf with rules takes its new matches. */
export async function autoJoinShelves(): Promise<{
  shelves: number;
  added: number;
}> {
  const shelves = await prisma.shelf.findMany({
    where: { autoJoin: true },
    select: { id: true, rules: true },
  });
  let added = 0;
  let joined = 0;
  for (const shelf of shelves) {
    const rules = rulesOf(shelf.rules);
    if (!rules || !hasRules(rules)) continue;
    joined++;
    added += await addRuleMatches(shelf.id, rules);
  }
  return { shelves: joined, added };
}

/** Fills `reason` on rule-sourced entries from the current rules and facts; admins only call this. */
export async function attachRuleReasons(
  views: ShelfEntryView[],
  rules: ShelfRules | null,
): Promise<ShelfEntryView[]> {
  const ruled = views.filter((v) => v.source === "rule");
  if (!ruled.length) return views;
  if (!rules || !hasRules(rules)) {
    return views.map((v) => (v.source === "rule" ? { ...v, reason: [] } : v));
  }
  const rows = await prisma.libraryMedia.findMany({
    where: { tmdbId: { in: [...new Set(ruled.map((v) => v.tmdb_id))] } },
    select: {
      tmdbId: true,
      type: true,
      genreIds: true,
      keywordIds: true,
      companyIds: true,
      networkIds: true,
      tmdbCollectionId: true,
      certification: true,
      voteCount: true,
      voteAverage: true,
    },
  });
  const facts = new Map<string, ReasonFacts>(
    rows.map((row) => [
      titleKey(row.type, row.tmdbId),
      {
        genre_ids: row.genreIds ?? [],
        keyword_ids: row.keywordIds ?? [],
        company_ids: row.companyIds ?? [],
        network_ids: row.networkIds ?? [],
        tmdb_collection_id: row.tmdbCollectionId ?? null,
        certification: row.certification ?? null,
        vote_count: row.voteCount ?? null,
        vote_average: row.voteAverage ?? null,
      },
    ]),
  );
  const nameOf = await loadRuleNames(rules);
  return views.map((v) => {
    if (v.source !== "rule") return v;
    const f = facts.get(titleKey(v.type as ShelfMediaType, v.tmdb_id));
    return { ...v, reason: f ? matchReasons(rules, f, nameOf) : [] };
  });
}
