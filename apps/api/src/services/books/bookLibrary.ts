import { prisma } from "@rawkoon/api/db";
import {
  getBookMetadataProvider,
  BookProviderUnavailableError,
} from "@rawkoon/api/services/books";
import type { BookEditionKind } from "@rawkoon/shared/types";

/**
 * Add a provider volume to the library.
 *
 * Extracted from the POST /api/books handler so the author-release worker adds
 * books the same way a person does — one upsert path, one set of edition
 * defaults, one author-link convention. A second implementation would drift.
 */

export type AddBookOutcome =
  | { added: true; bookId: number; created: boolean }
  | { added: false; reason: string; unavailable?: boolean };

/**
 * Resolve the profile for an edition kind.
 *
 * Kind-scoped so an ebook edition never inherits an audiobook profile. An
 * explicit id always wins; otherwise the exact-kind profile, then a `both`
 * profile, then the configured default.
 */
export async function resolveBookProfileId(
  kind: BookEditionKind,
  explicit?: number | null,
): Promise<number | null> {
  if (explicit) return explicit;
  const [profiles, settings] = await Promise.all([
    prisma.bookQualityProfile.findMany({ select: { id: true, kind: true } }),
    prisma.mediaSettings.findUnique({
      where: { id: 1 },
      select: { defaultBookQualityProfileId: true },
    }),
  ]);
  const exact = profiles.find((p) => p.kind === kind);
  if (exact) return exact.id;
  const both = profiles.find((p) => p.kind === "both");
  return both?.id ?? settings?.defaultBookQualityProfileId ?? null;
}

export async function addBookFromVolume(opts: {
  volumeId: string;
  kinds: BookEditionKind[];
  bookQualityProfileId?: number | null;
  monitored?: boolean;
}): Promise<AddBookOutcome> {
  const volumeId = opts.volumeId.trim();
  if (!volumeId) return { added: false, reason: "volumeId is required" };

  const kinds = opts.kinds.length > 0 ? opts.kinds : (["ebook"] as const);

  const provider = await getBookMetadataProvider();
  if (!provider) {
    return {
      added: false,
      reason: "Google Books is not configured. Add an API key in Integrations.",
    };
  }

  let meta;
  try {
    meta = await provider.getBook(volumeId);
  } catch (e) {
    // A provider outage is not "this book does not exist" — the caller has to
    // be able to retry later rather than record a permanent absence.
    if (e instanceof BookProviderUnavailableError) {
      return {
        added: false,
        reason: `Google Books is unavailable: ${e.message}`,
        unavailable: true,
      };
    }
    throw e;
  }
  if (!meta) return { added: false, reason: "Volume not found" };

  const profileByKind = new Map<BookEditionKind, number | null>();
  for (const kind of kinds) {
    profileByKind.set(
      kind,
      await resolveBookProfileId(kind, opts.bookQualityProfileId),
    );
  }

  const existing = await prisma.libraryBook.findUnique({
    where: { googleVolumeId: volumeId },
    select: { id: true },
  });

  const bookId = await prisma.$transaction(async (tx) => {
    const created = await tx.libraryBook.upsert({
      where: { googleVolumeId: volumeId },
      create: {
        googleVolumeId: volumeId,
        isbn13: meta.isbn13,
        title: meta.title,
        sortTitle: meta.title,
        subtitle: meta.subtitle,
        overview: meta.overview,
        coverUrl: meta.coverUrl,
        language: meta.language,
        publishedYear: meta.publishedYear,
        seriesName: meta.seriesName,
        seriesPosition: meta.seriesPosition,
      },
      update: {
        // Refresh metadata but never clobber the title, which is the indexer
        // search term and may have been overridden.
        isbn13: meta.isbn13,
        overview: meta.overview,
        coverUrl: meta.coverUrl,
        seriesName: meta.seriesName,
        seriesPosition: meta.seriesPosition,
      },
    });

    // Authors go through the join table; the trigger refreshes
    // LibraryBook.authors from role='author' rows.
    for (const name of meta.authors) {
      const author = await tx.author.upsert({
        where: { googleAuthorName: name },
        create: { googleAuthorName: name, sortName: name },
        update: {},
      });
      await tx.bookAuthor.upsert({
        where: {
          authorId_bookId_role: {
            authorId: author.id,
            bookId: created.id,
            role: "author",
          },
        },
        create: { authorId: author.id, bookId: created.id, role: "author" },
        update: {},
      });
    }

    // A book with no editions is invisible to every worker, so always create
    // at least one.
    for (const kind of kinds) {
      await tx.bookEdition.upsert({
        where: { bookId_kind: { bookId: created.id, kind } },
        create: {
          bookId: created.id,
          kind,
          monitored: opts.monitored ?? true,
          bookQualityProfileId: profileByKind.get(kind) ?? null,
        },
        update: {},
      });
    }

    return created.id;
  });

  return { added: true, bookId, created: !existing };
}
