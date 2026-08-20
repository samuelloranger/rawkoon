import { prisma } from "@rawkoon/api/db";
import { getActiveIndexerManager } from "@rawkoon/api/services/indexerManager";
import { checkBlocklist } from "@rawkoon/api/services/mediaGrabberHelpers";
import { logActivity } from "@rawkoon/api/utils/activityLogs";
import { emitBookUpdate } from "@rawkoon/api/services/libraryEvents";
import type { BookEditionKind, BookRelease } from "@rawkoon/shared/types";
import {
  scoreBookRelease,
  type BookScoreProfile,
} from "@rawkoon/api/utils/books/bookReleaseScorer";
import { notifyAdminsBookGrabbed } from "@rawkoon/api/workers/notifyBookEvents";
import { addReleaseToDownloadClient } from "./bookDownloadHandoff";
import { qbCategoryForEditionKind } from "./bookCategories";
import { tryAdoptQbDuplicateForBook } from "./bookAdopt";

export { qbCategoryForEditionKind };

/**
 * Book search and grab.
 *
 * Every book search is freetext — Torznab exposes no `isbn` or `bookid`
 * parameter (verified against live caps, which advertise `supportedParams="q"`
 * for book-search). Correctness therefore rests on the query ladder here and
 * the reject filter in bookReleaseScorer.
 */

const DEFAULT_PROFILE: Record<BookEditionKind, BookScoreProfile> = {
  ebook: {
    allowedFormats: ["epub", "azw3", "mobi", "pdf"],
    cutoffFormat: "epub",
    preferRetail: true,
    maxSizeMb: null,
    minSeeders: 1,
    minAudioBitrate: null,
    preferredLanguages: [],
    prioritizedTrackers: [],
    preferTrackerOverQuality: false,
  },
  audiobook: {
    allowedFormats: ["m4b", "mp3", "flac", "ogg"],
    cutoffFormat: "m4b",
    preferRetail: true,
    maxSizeMb: null,
    minSeeders: 1,
    minAudioBitrate: null,
    preferredLanguages: [],
    prioritizedTrackers: [],
    preferTrackerOverQuality: false,
  },
};

export type EditionContext = {
  editionId: number;
  kind: BookEditionKind;
  bookTitle: string;
  authors: string[];
  bookLanguage: string;
  profile: BookScoreProfile;
};

/**
 * The edition's identity plus its effective scoring profile.
 *
 * Exported because the RSS pass scores releases it did not search for and needs
 * exactly the same profile resolution — including the rule that the book's own
 * language is always a preference.
 */
export async function loadEditionContext(
  editionId: number,
): Promise<EditionContext | null> {
  const edition = await prisma.bookEdition.findUnique({
    where: { id: editionId },
    include: {
      book: {
        select: { title: true, authors: true, language: true, overrides: true },
      },
      bookQualityProfile: true,
    },
  });
  if (!edition) return null;

  const kind = edition.kind as BookEditionKind;
  const p = edition.bookQualityProfile;
  const profile: BookScoreProfile = p
    ? {
        allowedFormats: p.allowedFormats,
        cutoffFormat: p.cutoffFormat,
        preferRetail: p.preferRetail,
        maxSizeMb: p.maxSizeMb,
        minSeeders: p.minSeeders,
        minAudioBitrate: p.minAudioBitrate,
        preferredLanguages: p.preferredLanguages,
        prioritizedTrackers: p.prioritizedTrackers,
        preferTrackerOverQuality: p.preferTrackerOverQuality,
      }
    : DEFAULT_PROFILE[kind];

  // The book's own language is always a preference, even when the profile
  // lists none: a French book should rank French releases first.
  const preferredLanguages = profile.preferredLanguages.includes(
    edition.book.language,
  )
    ? profile.preferredLanguages
    : [...profile.preferredLanguages, edition.book.language];

  return {
    editionId,
    kind,
    bookTitle: edition.book.title,
    authors: edition.book.authors,
    bookLanguage: edition.book.language,
    profile: { ...profile, preferredLanguages },
  };
}

/**
 * Ordered query ladder. Surname first because it is the most discriminating
 * token a tracker reliably carries; the bare title is the fallback for
 * releases that omit the author.
 */
export function buildBookQueries(ctx: {
  bookTitle: string;
  authors: string[];
  kind: BookEditionKind;
  profile: BookScoreProfile;
}): string[] {
  const queries: string[] = [];
  const seen = new Set<string>();
  const push = (q: string) => {
    const t = q.trim().replace(/\s+/g, " ");
    if (!t) return;
    const key = t.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    queries.push(t);
  };

  const surname = ctx.authors[0]?.trim().split(/\s+/).pop();
  if (surname) push(`${ctx.bookTitle} ${surname}`);
  push(ctx.bookTitle);
  const preferredFormat = ctx.profile.allowedFormats[0];
  if (preferredFormat) push(`${ctx.bookTitle} ${preferredFormat}`);

  return queries;
}

export interface BookSearchOutcome {
  releases: BookRelease[];
  indexerWarnings: { id: string; name: string; error: string }[];
  /** Null when an indexer is configured but returned nothing usable. */
  error?: string;
}

/**
 * Search every query in the ladder, dedupe by guid, and score against the
 * edition. Stops early once a query yields at least one viable release, so a
 * good first hit does not cost three round trips.
 */
export async function searchBookReleases(
  editionId: number,
): Promise<BookSearchOutcome> {
  const ctx = await loadEditionContext(editionId);
  if (!ctx)
    return { releases: [], indexerWarnings: [], error: "Edition not found" };

  const adapter = await getActiveIndexerManager();
  if (!adapter) {
    return {
      releases: [],
      indexerWarnings: [],
      error: "No indexer manager configured",
    };
  }

  const queries = buildBookQueries(ctx);
  const byGuid = new Map<string, BookRelease>();
  const warnings = new Map<
    string,
    { id: string; name: string; error: string }
  >();

  for (const query of queries) {
    const { releases, indexerWarnings } = await adapter.search({
      query,
      type: "freetext",
      // Both kinds query categories 7000 + 3000; kind comes from the parsed
      // format, because trackers file audiobooks under Books too.
      mediaType: ctx.kind === "audiobook" ? "audiobook" : "book",
      limit: 100,
    });

    for (const w of indexerWarnings) warnings.set(w.id, w);

    for (const r of releases) {
      if (byGuid.has(r.guid)) continue;
      const scored = scoreBookRelease(
        {
          title: r.title,
          sizeBytes: r.sizeBytes,
          seeders: r.seeders,
          indexer: r.indexer,
        },
        {
          bookTitle: ctx.bookTitle,
          authors: ctx.authors,
          kind: ctx.kind,
          profile: ctx.profile,
        },
      );

      byGuid.set(r.guid, {
        guid: r.guid,
        title: r.title,
        indexer: r.indexer,
        size_bytes: r.sizeBytes,
        seeders: r.seeders,
        leechers: r.leechers,
        age: r.age,
        download_url: r.downloadUrl,
        magnet_url: r.magnetUrl,
        format: scored.parsed.format,
        kind: scored.kind,
        audio_bitrate: scored.parsed.audioBitrate,
        language: scored.parsed.language,
        release_group: scored.parsed.releaseGroup,
        is_retail: scored.parsed.isRetail,
        score: scored.score,
        rejected: scored.rejected,
        rejections: scored.rejections,
      });
    }

    if ([...byGuid.values()].some((r) => !r.rejected)) break;
  }

  const releases = [...byGuid.values()].sort((a, b) => {
    if (a.rejected !== b.rejected) return a.rejected ? 1 : -1;
    return b.score - a.score;
  });

  return { releases, indexerWarnings: [...warnings.values()] };
}

export type BookGrabOutcome =
  | { grabbed: true; releaseTitle: string }
  | { grabbed: false; reason: string };

/**
 * Grab one release for an edition.
 *
 * At most one active grab per edition is enforced by the
 * ux_download_history_active_book_target partial unique index. The pre-check
 * gives a clean rejection message; the P2002 catch closes the check-then-insert
 * race, exactly as the media path does.
 */
export async function grabBookRelease(opts: {
  editionId: number;
  downloadUrl: string;
  releaseTitle: string;
  indexer?: string | null;
  isUpgrade?: boolean;
}): Promise<BookGrabOutcome> {
  const releaseTitle = opts.releaseTitle.trim();
  if (!releaseTitle) return { grabbed: false, reason: "Missing release title" };

  const ctx = await loadEditionContext(opts.editionId);
  if (!ctx) return { grabbed: false, reason: "Edition not found" };

  const blockReason = await checkBlocklist(releaseTitle, null);
  if (blockReason) {
    return { grabbed: false, reason: `Blocklisted: ${blockReason}` };
  }

  const activeGrab = await prisma.downloadHistory.findFirst({
    where: { bookEditionId: opts.editionId, completedAt: null, failed: false },
    select: { id: true },
    orderBy: { id: "desc" },
  });
  if (activeGrab) {
    return {
      grabbed: false,
      reason: `Already downloading (grab #${activeGrab.id})`,
    };
  }

  let dhRow: { id: number };
  try {
    dhRow = await prisma.downloadHistory.create({
      data: {
        bookEditionId: opts.editionId,
        releaseTitle,
        indexer: opts.indexer?.trim() || null,
        downloadUrl: opts.downloadUrl.trim(),
        isUpgrade: opts.isUpgrade ?? false,
      },
      select: { id: true },
    });
  } catch (e) {
    // ux_download_history_active_book_target — lost the race to a concurrent grab.
    if ((e as { code?: string }).code === "P2002") {
      return { grabbed: false, reason: "Already downloading" };
    }
    throw e;
  }

  const handoff = await addReleaseToDownloadClient({
    downloadUrl: opts.downloadUrl,
    category: qbCategoryForEditionKind(ctx.kind),
    tag: `rawkoon-dh-${dhRow.id}`,
  });

  if (!handoff.ok) {
    // The client already holds this torrent. Take it over rather than fail:
    // the alternative left an edition permanently ungrabbable whenever an
    // earlier attempt outlived its DownloadHistory row.
    if (handoff.duplicate) {
      const adopted = await tryAdoptQbDuplicateForBook({
        dhRowId: dhRow.id,
        editionId: opts.editionId,
        kind: ctx.kind,
        torrentHash: handoff.torrentHash ?? null,
        releaseTitle,
        bookTitle: ctx.bookTitle,
        isUpgrade: opts.isUpgrade,
      });
      if (adopted) return { grabbed: true, releaseTitle };
    }

    await prisma.downloadHistory.update({
      where: { id: dhRow.id },
      data: { failed: true, failReason: handoff.reason },
    });
    return { grabbed: false, reason: handoff.reason };
  }

  await prisma.downloadHistory.update({
    where: { id: dhRow.id },
    data: { torrentHash: handoff.torrentHash },
  });

  const updated = await prisma.bookEdition.update({
    where: { id: opts.editionId },
    data: {
      // An upgrade keeps the file it is replacing, so it is not "downloading"
      // from nothing — revertToWantedIfNoActiveGrabs relies on the distinction
      // to put a failed upgrade back to downloaded rather than wanted.
      status: opts.isUpgrade ? "upgrading" : "downloading",
      searchAttempts: { increment: 1 },
    },
    select: { bookId: true },
  });
  emitBookUpdate(updated.bookId);

  try {
    await notifyAdminsBookGrabbed(opts.editionId, releaseTitle);
  } catch (e) {
    console.warn("[bookGrabber] grab notification failed:", e);
  }

  try {
    await logActivity({
      type: "book_grab",
      payload: {
        editionId: opts.editionId,
        kind: ctx.kind,
        bookTitle: ctx.bookTitle,
        releaseTitle,
      },
    });
  } catch {
    // Activity logging is best-effort; never fail a successful grab on it.
  }

  return { grabbed: true, releaseTitle };
}

/** Search, then grab the best viable release. */
export async function searchAndGrabBook(
  editionId: number,
): Promise<BookGrabOutcome> {
  const { releases, error } = await searchBookReleases(editionId);
  if (error) return { grabbed: false, reason: error };

  const viable = releases.filter(
    (r) => !r.rejected && (r.download_url || r.magnet_url),
  );
  if (viable.length === 0) {
    return { grabbed: false, reason: "No matching releases found" };
  }
  // searchBookReleases already sorted viable-first by descending score.
  const best = viable[0];

  const url = best.download_url ?? best.magnet_url;
  if (!url) return { grabbed: false, reason: "Release has no download URL" };

  return grabBookRelease({
    editionId,
    downloadUrl: url,
    releaseTitle: best.title,
    indexer: best.indexer,
  });
}
