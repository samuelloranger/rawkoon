import { prisma } from "@rawkoon/api/db";
import { searchAndGrabWithTitleFallback } from "@rawkoon/api/services/mediaGrabberSearch";
import { resolveSearchTitles } from "@rawkoon/api/utils/medias/resolveSearchTitles";
import { refreshLibraryMovieDigitalDate } from "@rawkoon/api/services/libraryTmdbRefresh";
import { isNoMissRefusal } from "@rawkoon/api/services/grabRefusal";
import { MAX_LIBRARY_GRAB_ATTEMPTS } from "@rawkoon/api/constants/libraryGrab";
import {
  isGrabSearchDue,
  recordMovieMiss,
} from "@rawkoon/api/services/grabAttempts";
import {
  publishSearchResult,
  searchResultFrom,
} from "@rawkoon/api/services/searchResult";
import {
  APP_DISPLAY_TIMEZONE,
  localDateYmd,
  toUtcMidnightDate,
} from "@rawkoon/shared/utils/date";

/** A future date is re-checked at most about once a day, whatever the schedule. */
const DIGITAL_RELEASE_RECHECK_MS = 20 * 60 * 60 * 1000;

export function isDigitalReleaseCheckStale(
  checkedAt: Date | null,
  now: Date = new Date(),
): boolean {
  return (
    !checkedAt ||
    now.getTime() - checkedAt.getTime() >= DIGITAL_RELEASE_RECHECK_MS
  );
}

export async function checkMovieReleases(): Promise<void> {
  // digitalReleaseDate is a DATE column — interpret it as a calendar day in
  // the app's display timezone (TZ env var → NY fallback), not UTC.
  const todayCutoff = toUtcMidnightDate(localDateYmd(APP_DISPLAY_TIMEZONE));

  const movies = await prisma.libraryMedia.findMany({
    where: {
      type: "movie",
      status: "wanted",
      monitored: true,
      files: { none: {} },
      searchAttempts: { lt: MAX_LIBRARY_GRAB_ATTEMPTS },
    },
    select: {
      id: true,
      title: true,
      searchTitle: true,
      originalTitle: true,
      year: true,
      qualityProfileId: true,
      searchAttempts: true,
      lastMissAt: true,
      digitalReleaseDate: true,
      digitalReleaseCheckedAt: true,
    },
  });

  for (const m of movies) {
    try {
      let digital = m.digitalReleaseDate;
      // A released title backing off between searches needs no TMDB call either.
      if (digital && digital <= todayCutoff && !isGrabSearchDue(m)) continue;
      // Re-validate from TMDB when the date is missing, already due, or not
      // checked lately. TMDB community data is mutable: a date cached as
      // "released" can be corrected to a future date (re-fetching avoids
      // burning search attempts on it), and a future date can move earlier.
      if (
        !digital ||
        digital <= todayCutoff ||
        isDigitalReleaseCheckStale(m.digitalReleaseCheckedAt)
      ) {
        try {
          digital = await refreshLibraryMovieDigitalDate(m.id);
        } catch (e) {
          console.warn(
            `[checkMovieReleases] TMDB refresh failed for media ${m.id}:`,
            e,
          );
          continue;
        }
      }
      if (!digital) continue;

      // Not yet released digitally — nothing to search.
      if (digital > todayCutoff) continue;
      if (!isGrabSearchDue(m)) continue;

      const { queries } = resolveSearchTitles({
        title: m.title,
        searchTitle: m.searchTitle,
        originalTitle: m.originalTitle,
      });
      const result = await searchAndGrabWithTitleFallback({
        trigger: "scheduled",
        mediaId: m.id,
        mediaType: "movie",
        titleBaseQueries: queries,
        suffix: m.year ? ` ${m.year}` : "",
        qualityProfileId: m.qualityProfileId,
      });

      await publishSearchResult(searchResultFrom(m.id, result));

      // A grab held by the profile's delay isn't a miss; don't burn an attempt.
      if (result.grabbed || result.delayed) continue;
      // A full disk is not the release's fault and clears on its own; keep the item wanted.
      // Another grab already running for it is not a miss either.
      if (
        isNoMissRefusal(result.refusal) ||
        result.refusal === "already_active"
      )
        continue;

      await recordMovieMiss(m, result.reason);
    } catch (e) {
      console.warn(`[checkMovieReleases] Failed for movie ${m.id}:`, e);
    }
  }
}
