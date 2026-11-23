import { prisma } from "@rawkoon/api/db";
import { MAX_CRON_GRAB_ATTEMPTS } from "@rawkoon/api/constants/libraryGrab";
import {
  describeBookRelease,
  grabBookRelease,
  loadEditionContext,
  searchAndGrabBook,
  searchBookReleases,
} from "@rawkoon/api/services/books/bookGrabber";
import { pickBookCandidate } from "@rawkoon/api/services/books/bookAiPick";
import { notifyAdminsBookSearchSkipped } from "@rawkoon/api/workers/notifyBookEvents";
import { meetsBookCutoff } from "@rawkoon/api/utils/books/bookReleaseScorer";
import { getJsonCache, setJsonCache } from "@rawkoon/api/services/cache";
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
      const result = await searchAndGrabBook(edition.id, "scheduled");
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
 * How long an edition rests after an upgrade search that found nothing better.
 * Book upgrades aren't time-critical; without a rest, an edition with no better
 * release out there is searched on every sweep, forever.
 */
export const UPGRADE_SEARCH_COOLDOWN_S = 7 * 24 * 60 * 60;

const upgradeCooldownKey = (editionId: number) =>
  `books:upgrade-searched:${editionId}`;

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
      files: { select: { format: true, audioBitrate: true } },
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
    const heldBitrate = highestBitrate(edition.files, best);
    // What the last empty search was judged against: a profile edit or a
    // different held file ends the rest early.
    const searchedFor = [
      best,
      heldBitrate ?? "",
      profile.cutoffFormat,
      ...profile.allowedFormats,
    ].join("|");
    // Shortcut: the rest lives in Valkey, so a flush only means one early search.
    const rested = await getJsonCache<string>(upgradeCooldownKey(edition.id));
    if (rested === searchedFor) continue;

    try {
      const { releases, error } = await searchBookReleases(edition.id);
      if (error) continue;

      // Only a release strictly better than what is held is an upgrade.
      const upgrades = releases.filter((r) => {
        if (r.rejected) return false;
        if (!r.format) return false;
        if (!(r.download_url ?? r.magnet_url)) return false;
        const idx = profile.allowedFormats.indexOf(r.format);
        if (idx === -1) return false;
        if (idx >= profile.allowedFormats.indexOf(best)) return false;
        // A better container at a lower bitrate is a sidegrade, not an upgrade.
        return !(
          heldBitrate != null &&
          r.audio_bitrate != null &&
          r.audio_bitrate < heldBitrate
        );
      });
      if (upgrades.length === 0) {
        await setJsonCache(
          upgradeCooldownKey(edition.id),
          searchedFor,
          UPGRADE_SEARCH_COOLDOWN_S,
        );
        continue;
      }

      // Only a real choice needs the judge, and its context costs a query.
      const editionCtx =
        upgrades.length > 1 ? await loadEditionContext(edition.id) : null;
      const { pick: candidate, aiPicked } = editionCtx
        ? await pickBookCandidate(
            editionCtx,
            upgrades,
            "upgrade",
            describeBookRelease,
          )
        : { pick: upgrades[0], aiPicked: false };
      if (!candidate) {
        // The judge turned every upgrade down; rest like an empty search so it isn't asked again each sweep.
        await setJsonCache(
          upgradeCooldownKey(edition.id),
          searchedFor,
          UPGRADE_SEARCH_COOLDOWN_S,
        );
        continue;
      }

      const url = candidate.download_url ?? candidate.magnet_url;
      if (!url) continue;

      const result = await grabBookRelease({
        editionId: edition.id,
        downloadUrl: url,
        releaseTitle: candidate.title,
        indexer: candidate.indexer,
        isUpgrade: true,
        aiPicked,
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

/** Highest known bitrate among the held files of one format, or null. */
function highestBitrate(
  files: { format: string; audioBitrate: number | null }[],
  format: BookFormat,
): number | null {
  let max: number | null = null;
  for (const f of files) {
    if (f.format !== format || f.audioBitrate == null) continue;
    if (max == null || f.audioBitrate > max) max = f.audioBitrate;
  }
  return max;
}

export async function checkBookReleases(): Promise<void> {
  if (!(await booksEnabled())) return;
  await searchWantedBookEditions();
  await searchBookUpgrades();
}
