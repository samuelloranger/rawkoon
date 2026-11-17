import { prisma } from "@rawkoon/api/db";
import { searchLibraryTarget } from "@rawkoon/api/services/searchLibraryTarget";
import { refreshLibraryMovieDigitalDate } from "@rawkoon/api/services/libraryTmdbRefresh";
import {
  airedEpisodeCutoff,
  completeSeriesSeasons,
  enqueueSeasonSearches,
  isMovieReleased,
  type SearchScope,
} from "@rawkoon/api/services/searchOnAdd";
import { activeShowGrabCover } from "@rawkoon/api/services/activeShowGrab";
import type { SearchResultPayload } from "@rawkoon/shared/types";
import {
  GENERIC_ERROR_REASON,
  notReleasedResult,
  publishSearchResult,
} from "@rawkoon/api/services/searchResult";

type SearchTarget = {
  id: number;
  title: string;
  searchTitle: string | null;
  originalTitle: string | null;
  year: number | null;
  qualityProfileId: number | null;
};

/**
 * Looks for a release right after a title is added. Same scoring/grab path as
 * the scheduled checks, but a miss is not recorded: the scheduled checks keep
 * their own attempt budget and pick the title up later.
 */
/** `scope` a number = one season of a show; "series" = the complete-series pack search. */
export async function searchOnAdd(
  mediaId: number,
  scope?: SearchScope,
  /** False while BullMQ will retry the job. */
  isFinalAttempt = true,
): Promise<void> {
  const season = typeof scope === "number" ? scope : undefined;
  try {
    await runSearchOnAdd(mediaId, scope);
  } catch (e) {
    console.warn(`[searchOnAdd] Search failed for ${mediaId}:`, e);
    // A retry may still grab, so only the last attempt tells the toast it failed.
    if (isFinalAttempt) {
      await publishSearchResult({
        media_id: mediaId,
        ...(season != null ? { season } : {}),
        outcome: "error",
        reason: GENERIC_ERROR_REASON,
      });
    }
    throw e;
  }
}

async function runSearchOnAdd(mediaId: number, scope?: SearchScope) {
  const media = await prisma.libraryMedia.findUnique({
    where: { id: mediaId },
    select: {
      id: true,
      type: true,
      status: true,
      monitored: true,
      title: true,
      searchTitle: true,
      originalTitle: true,
      year: true,
      qualityProfileId: true,
      digitalReleaseDate: true,
      _count: { select: { files: true } },
    },
  });
  // The scheduled checks skip unmonitored titles, so this does too.
  if (!media || !media.monitored) return;

  if (media.type === "movie") {
    if (media.status !== "wanted" || media._count.files > 0) return;
    await searchMovie(media, media.digitalReleaseDate);
  } else if (scope === "series") {
    await searchCompleteSeries(media);
  } else {
    await searchShow(media, scope);
  }
}

/**
 * First step for a clean-slate show: one pack covering every aired season.
 * A grab or a hold ends the search; anything else queues the season jobs.
 */
async function searchCompleteSeries(media: SearchTarget): Promise<void> {
  if (await activeShowGrabCover(media.id)) return;
  const seasons = await completeSeriesSeasons(media.id);
  if (seasons) {
    try {
      const {
        result: pack,
        payload,
        blocked,
      } = await searchLibraryTarget(
        media,
        { kind: "show", completeSeasons: seasons },
        { trigger: "scheduled", publish: false },
      );
      // A full disk won't improve by searching season by season either.
      if (pack.grabbed || pack.delayed || blocked) {
        await publishSearchResult(payload);
        return;
      }
    } catch (e) {
      console.warn(
        `[searchOnAdd] Complete-series search failed for ${media.id}:`,
        e,
      );
    }
  }
  await enqueueSeasonSearches(media.id);
}

async function searchMovie(
  media: SearchTarget,
  cachedDigital: Date | null,
): Promise<void> {
  let digital = cachedDigital;
  // TMDB dates are mutable, so a missing or due date is re-validated like the scheduled check does.
  if (!isMovieReleased(digital)) {
    try {
      digital = await refreshLibraryMovieDigitalDate(media.id);
    } catch (e) {
      console.warn(`[searchOnAdd] TMDB refresh failed for ${media.id}:`, e);
      await publishSearchResult({
        media_id: media.id,
        outcome: "error",
        reason: GENERIC_ERROR_REASON,
      });
      return;
    }
  }
  if (!isMovieReleased(digital)) {
    await publishSearchResult(notReleasedResult(media.id, digital));
    return;
  }

  await searchLibraryTarget(media, { kind: "movie" }, { trigger: "scheduled" });
}

/** One result for the whole call: a grab beats a held grab, which beats a miss. */
function summarize(
  mediaId: number,
  season: number | undefined,
  results: SearchResultPayload[],
): SearchResultPayload {
  const withSeason = (r: SearchResultPayload): SearchResultPayload =>
    season != null ? { ...r, season } : r;
  const grabbed = results.find((r) => r.outcome === "grabbed");
  if (grabbed) return withSeason(grabbed);
  const held = results
    .filter((r) => r.outcome === "delayed")
    .sort((a, b) => (a.delay_until ?? "").localeCompare(b.delay_until ?? ""));
  if (held[0]) {
    const keys = held.flatMap((r) => (r.target_key ? [r.target_key] : []));
    return withSeason({ ...held[0], target_keys: keys });
  }
  const miss = results.find((r) => r.outcome === "no_match");
  if (miss) return withSeason(miss);
  const failed = results.find((r) => r.outcome === "error");
  if (failed) return withSeason(failed);
  return withSeason({ media_id: mediaId, outcome: "not_released" });
}

async function searchShow(
  media: SearchTarget,
  onlySeason?: number,
): Promise<void> {
  // Seasons a show-level pack in flight carries would double-grab if searched again.
  const cover = await activeShowGrabCover(media.id);

  const cutoff = airedEpisodeCutoff();
  const episodes = await prisma.libraryEpisode.findMany({
    where: {
      mediaId: media.id,
      monitored: true,
      season: onlySeason ?? { gt: 0 },
    },
    select: {
      id: true,
      season: true,
      episode: true,
      status: true,
      airDate: true,
      _count: { select: { files: true } },
    },
    orderBy: [{ season: "asc" }, { episode: "asc" }],
  });

  const seasons = new Map<number, typeof episodes>();
  for (const ep of episodes) {
    const list = seasons.get(ep.season) ?? [];
    list.push(ep);
    seasons.set(ep.season, list);
  }

  const results: SearchResultPayload[] = [];
  seasonLoop: for (const [season, all] of seasons) {
    if (cover?.(season)) continue;
    const wanted = all.filter(
      (ep) =>
        ep.status === "wanted" &&
        ep._count.files === 0 &&
        ep.airDate != null &&
        ep.airDate <= cutoff,
    );
    if (wanted.length === 0) {
      // Nothing to look for yet; the next air date tells the user when.
      const next = all
        .filter((ep) => ep.airDate != null && ep.airDate > cutoff)
        .map((ep) => ep.airDate!)
        .sort((a, b) => a.getTime() - b.getTime())[0];
      results.push(notReleasedResult(media.id, next ?? null));
      continue;
    }

    // A fully aired, untouched season is looked for as a pack first.
    if (wanted.length === all.length) {
      try {
        const {
          result: pack,
          payload,
          blocked,
        } = await searchLibraryTarget(
          media,
          { kind: "season", season },
          { trigger: "scheduled", publish: false },
        );
        results.push(payload);
        // A held grab or a full disk won't improve by searching episode by episode.
        if (pack.grabbed || pack.delayed || blocked) {
          continue;
        }
      } catch (e) {
        console.warn(
          `[searchOnAdd] Season pack failed for ${media.id} S${season}:`,
          e,
        );
      }
    }

    for (const ep of wanted) {
      try {
        const { payload, blocked } = await searchLibraryTarget(
          media,
          {
            kind: "episode",
            episodeId: ep.id,
            season: ep.season,
            episode: ep.episode,
          },
          { trigger: "scheduled", publish: false },
        );
        results.push(payload);
        if (blocked) {
          break seasonLoop;
        }
      } catch (e) {
        console.warn(`[searchOnAdd] Episode ${ep.id} failed:`, e);
        results.push({
          media_id: media.id,
          outcome: "error",
          reason: GENERIC_ERROR_REASON,
        });
      }
    }
  }

  await publishSearchResult(summarize(media.id, onlySeason, results));
}
