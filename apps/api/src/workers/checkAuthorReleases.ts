import { prisma } from "@rawkoon/api/db";
import { BookProviderUnavailableError } from "@rawkoon/api/services/books";
import { getBookMetadataProvider } from "@rawkoon/api/services/books";
import { addBookFromVolume } from "@rawkoon/api/services/books/bookLibrary";
import { notifyAdminsAuthorNewReleases } from "@rawkoon/api/workers/notifyBookEvents";
import type { BookEditionKind } from "@rawkoon/shared/types";

/**
 * Add new titles from monitored authors.
 *
 * Google Books exposes no author id, so an author IS a name string (see the
 * spec's risk list: homonymous authors collide). `inauthor:` is the only handle
 * available, and it is what the provider's getAuthorBooks uses.
 *
 * `monitorLanguages` is the guard against collecting every translation: a book
 * is one language (see LibraryBook.language), so "the French one" and "the
 * English one" are two different rows. Empty means any language.
 *
 * `monitorFrom` is the guard against a first run pulling an author's entire
 * backlist into the library: only volumes published in or after that year are
 * added. An author monitored with no monitorFrom is treated as "from now",
 * using the year the monitoring was switched on.
 */

const KINDS: BookEditionKind[] = ["ebook", "audiobook"];

function normalizeKinds(raw: string[]): BookEditionKind[] {
  const kinds = raw.filter((k): k is BookEditionKind =>
    KINDS.includes(k as BookEditionKind),
  );
  return kinds.length > 0 ? kinds : ["ebook"];
}

export async function checkAuthorReleases(): Promise<void> {
  const settings = await prisma.appSettings.findUnique({
    where: { id: 1 },
    select: { booksEnabled: true },
  });
  if (settings?.booksEnabled !== true) return;

  const provider = await getBookMetadataProvider();
  if (!provider) return;

  const authors = await prisma.author.findMany({
    where: { monitored: true },
    select: {
      id: true,
      googleAuthorName: true,
      monitorFrom: true,
      monitorEditionKinds: true,
      monitorLanguages: true,
      bookQualityProfileId: true,
      updatedAt: true,
    },
  });

  for (const author of authors) {
    try {
      let volumes;
      try {
        volumes = await provider.getAuthorBooks(author.googleAuthorName, {
          limit: 40,
          languages: author.monitorLanguages,
        });
      } catch (e) {
        // A provider outage must not advance lastCheckedAt: the next run has to
        // cover the same window, or new titles published during the outage are
        // never seen.
        if (e instanceof BookProviderUnavailableError) {
          console.warn(
            `[checkAuthorReleases] provider unavailable for "${author.googleAuthorName}": ${e.message}`,
          );
          continue;
        }
        throw e;
      }

      const fromYear = (
        author.monitorFrom ?? author.updatedAt
      ).getUTCFullYear();

      // langRestrict narrows the query, but the volume's own language is what
      // ends up on the row — and mapVolume rewrites it when the ISBN
      // registration group disagrees with Google. Filter on that final value,
      // or a French-only follow still lands the odd English edition.
      const wanted = new Set(author.monitorLanguages);
      const candidates = volumes.filter(
        (v) =>
          v.publishedYear != null &&
          v.publishedYear >= fromYear &&
          (wanted.size === 0 || wanted.has(v.language)),
      );

      const existing = await prisma.libraryBook.findMany({
        where: { googleVolumeId: { in: candidates.map((c) => c.volumeId) } },
        select: { googleVolumeId: true },
      });
      const known = new Set(existing.map((b) => b.googleVolumeId));

      const addedTitles: string[] = [];
      for (const volume of candidates) {
        if (known.has(volume.volumeId)) continue;
        const result = await addBookFromVolume({
          volumeId: volume.volumeId,
          kinds: normalizeKinds(author.monitorEditionKinds),
          bookQualityProfileId: author.bookQualityProfileId,
          monitored: true,
        });
        if (result.added && result.created) {
          addedTitles.push(volume.title);
        } else if (!result.added) {
          console.warn(
            `[checkAuthorReleases] could not add "${volume.title}": ${result.reason}`,
          );
        }
      }

      await prisma.author.update({
        where: { id: author.id },
        data: { lastCheckedAt: new Date() },
      });

      if (addedTitles.length > 0) {
        await notifyAdminsAuthorNewReleases(
          author.googleAuthorName,
          addedTitles,
        );
      }
    } catch (e) {
      console.warn(
        `[checkAuthorReleases] failed for author ${author.id} ("${author.googleAuthorName}"):`,
        e,
      );
    }
  }
}
