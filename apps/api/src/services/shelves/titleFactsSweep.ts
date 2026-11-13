import { prisma } from "@rawkoon/api/db";
import { getLibraryTmdbApiKey } from "@rawkoon/api/utils/medias/libraryHelpers";
import { getGlobalTmdbRegion } from "@rawkoon/api/utils/medias/tmdbRegion";
import { shelfTypeOf } from "./shelfMapping";
import { autoJoinShelves } from "./shelfRulesService";
import { fetchTitleFacts, type TitleFacts } from "./titleFacts";

const DAY_MS = 24 * 60 * 60 * 1000;
export const STALE_AFTER_MS = 30 * DAY_MS;

export interface SweepOptions {
  /** Titles looked at per run, per phase (new, then stale); the rest wait for the next night. */
  maxTitles?: number;
  /** Titles fetched at once; TMDB tolerates far more, this is a courtesy to it and to the box. */
  concurrency?: number;
  /** Pause between batches. */
  delayMs?: number;
  /** Skip the auto-join pass (the backfill script runs it separately). */
  autoJoin?: boolean;
}

export interface SweepResult {
  filled: number;
  refreshed: number;
  failed: number;
  rateLimited: boolean;
  joined: { shelves: number; added: number } | null;
}

const sleep = (ms: number) =>
  ms > 0
    ? new Promise((resolve) => setTimeout(resolve, ms))
    : Promise.resolve();

/** The HTTP status `tmdbApiFetch` puts at the end of its error message. */
const statusOf = (error: unknown): number | null => {
  const hit = /→ (\d{3})$/.exec(error instanceof Error ? error.message : "");
  return hit ? Number(hit[1]) : null;
};

const EMPTY_FACTS: TitleFacts = {
  genreIds: [],
  keywordIds: [],
  companyIds: [],
  networkIds: [],
  tmdbCollectionId: null,
  certification: null,
  voteCount: null,
  voteAverage: null,
};

type Target = { id: number; tmdbId: number; type: string };

/**
 * Fetch facts for `targets` in small concurrent batches. `store` writes one
 * result. A 404 is final (the title is gone from TMDB) so it is stored empty and
 * not retried; a 429 stops the run; any other failure is retried next run.
 */
async function processTargets(
  targets: Target[],
  country: string,
  apiKey: string,
  opts: Required<Pick<SweepOptions, "concurrency" | "delayMs">>,
  store: (target: Target, facts: TitleFacts) => Promise<void>,
  result: SweepResult,
  count: "filled" | "refreshed",
) {
  for (
    let i = 0;
    i < targets.length && !result.rateLimited;
    i += opts.concurrency
  ) {
    const batch = targets.slice(i, i + opts.concurrency);
    await Promise.all(
      batch.map(async (target) => {
        try {
          const facts = await fetchTitleFacts(
            apiKey,
            target.tmdbId,
            shelfTypeOf(target.type),
            country,
          );
          await store(target, facts);
          result[count]++;
        } catch (error) {
          const status = statusOf(error);
          if (status === 404) {
            await store(target, EMPTY_FACTS);
            result[count]++;
          } else {
            if (status === 429) result.rateLimited = true;
            result.failed++;
            console.warn(
              `[titleFactsSweep] tmdb ${target.tmdbId} (${target.type}) failed:`,
              error,
            );
          }
        }
      }),
    );
    if (i + opts.concurrency < targets.length) await sleep(opts.delayMs);
  }
}

/**
 * Nightly: fill facts for titles never fetched, refresh vote numbers older than
 * 30 days, then let auto-join shelves take their new matches.
 */
export async function runTitleFactsSweep(
  options: SweepOptions = {},
): Promise<SweepResult> {
  const { maxTitles = 500, concurrency = 3, delayMs = 400 } = options;
  const result: SweepResult = {
    filled: 0,
    refreshed: 0,
    failed: 0,
    rateLimited: false,
    joined: null,
  };
  const apiKey = await getLibraryTmdbApiKey();
  if (!apiKey) return result;
  const country = await getGlobalTmdbRegion();
  const opts = { concurrency, delayMs };

  const fresh = await prisma.libraryMedia.findMany({
    where: { factsFetchedAt: null },
    orderBy: { id: "asc" },
    take: maxTitles,
    select: { id: true, tmdbId: true, type: true },
  });
  await processTargets(
    fresh,
    country,
    apiKey,
    opts,
    async (target, facts) => {
      await prisma.libraryMedia.update({
        where: { id: target.id },
        data: { ...facts, factsFetchedAt: new Date() },
      });
    },
    result,
    "filled",
  );

  if (!result.rateLimited) {
    const stale = await prisma.libraryMedia.findMany({
      where: { factsFetchedAt: { lt: new Date(Date.now() - STALE_AFTER_MS) } },
      orderBy: { factsFetchedAt: "asc" },
      take: maxTitles,
      select: { id: true, tmdbId: true, type: true },
    });
    await processTargets(
      stale,
      country,
      apiKey,
      opts,
      async (target, facts) => {
        // Genres and keywords rarely change; votes do. Only they are refreshed.
        await prisma.libraryMedia.update({
          where: { id: target.id },
          data: {
            voteCount: facts.voteCount,
            voteAverage: facts.voteAverage,
            factsFetchedAt: new Date(),
          },
        });
      },
      result,
      "refreshed",
    );
  }

  if (options.autoJoin !== false) result.joined = await autoJoinShelves();
  return result;
}
