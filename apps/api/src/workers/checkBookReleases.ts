import { prisma } from "@rawkoon/api/db";
import { MAX_CRON_GRAB_ATTEMPTS } from "@rawkoon/api/constants/libraryGrab";
import {
  grabBookRelease,
  searchAndGrabBook,
  searchBookReleases,
} from "@rawkoon/api/services/books/bookGrabber";
import { notifyAdminsBookSearchSkipped } from "@rawkoon/api/workers/notifyBookEvents";
import { meetsBookCutoff } from "@rawkoon/api/utils/books/bookReleaseScorer";
import type { BookFormat } from "@rawkoon/shared/types";

/**
 * Hands-off book acquisition.
 *
 * The books counterpart of checkMovieReleases + upgradeMediaSearch, in one
 * scheduled job with two passes:
 *
 *  1. Wanted editions get searched and grabbed.
 *  2. Downloaded editions below their profile's cutoff format get an upgrade
 *     search — a retail epub replacing an OCR pdf is the book equivalent of
 *     1080p replacing 720p.
 *
 * Both passes are gated on AppSettings.booksEnabled, so a movies-only install
 * never touches an indexer for books.
 *
 * There is no publication-date gate, unlike movies: a book has no digital
 * release window worth waiting on, and Google Books' own dates are unreliable
 * enough that gating on them would silently starve real searches.
 */

async function booksEnabled(): Promise<boolean> {
  const settings = await prisma.appSettings.findUnique({
    where: { id: 1 },
    select: { booksEnabled: true },
  });
  return settings?.booksEnabled === true;
}

/** Pass 1: search every monitored wanted edition. */
export async function searchWantedBookEditions(): Promise<void> {
  const editions = await prisma.bookEdition.findMany({
    where: {
      monitored: true,
      status: "wanted",
      files: { none: {} },
      searchAttempts: { lt: MAX_CRON_GRAB_ATTEMPTS },
    },
    select: {
      id: true,
      searchAttempts: true,
      book: { select: { title: true } },
    },
  });

  for (const edition of editions) {
    try {
      const result = await searchAndGrabBook(edition.id);
      if (result.grabbed) continue;

      // searchAndGrabBook only bumps searchAttempts when it actually grabbed,
      // so the cron pass owns the counter for a failed sweep — without it a
      // permanently unavailable title would be searched forever.
      const next = edition.searchAttempts + 1;
      const reachedCap = next >= MAX_CRON_GRAB_ATTEMPTS;
      await prisma.bookEdition.update({
        where: { id: edition.id },
        data: {
          searchAttempts: next,
          ...(reachedCap ? { status: "skipped" } : {}),
        },
      });

      if (reachedCap) {
        await notifyAdminsBookSearchSkipped(
          edition.id,
          `${MAX_CRON_GRAB_ATTEMPTS} failed search attempts (${result.reason}). Set to skipped.`,
        );
      }
    } catch (e) {
      console.warn(
        `[checkBookReleases] search failed for edition ${edition.id}:`,
        e,
      );
    }
  }
}

/**
 * Pass 2: upgrade searches for downloaded editions below their cutoff.
 *
 * An edition at or above its cutoff is left alone, which is the whole point of
 * having one — otherwise every downloaded book would be re-searched forever.
 */
export async function searchBookUpgrades(): Promise<void> {
  const editions = await prisma.bookEdition.findMany({
    where: { monitored: true, status: "downloaded" },
    select: {
      id: true,
      files: { select: { format: true } },
      bookQualityProfile: {
        select: { allowedFormats: true, cutoffFormat: true },
      },
    },
  });

  for (const edition of editions) {
    const profile = edition.bookQualityProfile;
    // No profile means no cutoff to compare against, so nothing to upgrade to.
    if (!profile?.cutoffFormat) continue;
    if (edition.files.length === 0) continue;

    // Best held format wins: an edition holding both pdf and epub is only
    // below cutoff if even its best file is.
    const best = edition.files
      .map((f) => f.format as BookFormat)
      .filter((f) => profile.allowedFormats.includes(f))
      .sort(
        (a, b) =>
          profile.allowedFormats.indexOf(a) - profile.allowedFormats.indexOf(b),
      )[0];
    if (!best) continue;

    const scoreProfile = {
      allowedFormats: profile.allowedFormats as BookFormat[],
      cutoffFormat: profile.cutoffFormat as BookFormat,
    };
    if (meetsBookCutoff(best, scoreProfile)) continue;

    try {
      const { releases, error } = await searchBookReleases(edition.id);
      if (error) continue;

      // Only a release strictly better than what is held is an upgrade.
      const candidate = releases.find((r) => {
        if (r.rejected) return false;
        if (!r.format) return false;
        const idx = profile.allowedFormats.indexOf(r.format);
        if (idx === -1) return false;
        return idx < profile.allowedFormats.indexOf(best);
      });
      if (!candidate) continue;

      const url = candidate.download_url ?? candidate.magnet_url;
      if (!url) continue;

      const result = await grabBookRelease({
        editionId: edition.id,
        downloadUrl: url,
        releaseTitle: candidate.title,
        indexer: candidate.indexer,
        isUpgrade: true,
      });
      if (!result.grabbed) {
        console.warn(
          `[checkBookReleases] upgrade grab refused for edition ${edition.id}: ${result.reason}`,
        );
      }
    } catch (e) {
      console.warn(
        `[checkBookReleases] upgrade search failed for edition ${edition.id}:`,
        e,
      );
    }
  }
}

export async function checkBookReleases(): Promise<void> {
  if (!(await booksEnabled())) return;
  await searchWantedBookEditions();
  await searchBookUpgrades();
}
