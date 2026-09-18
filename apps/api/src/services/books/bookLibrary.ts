import { prisma } from "@rawkoon/api/db";
import {
  getBookMetadataProvider,
  BookProviderUnavailableError,
} from "@rawkoon/api/services/books";
import { pinQueriedIsbn } from "@rawkoon/api/services/books/googleBooksProvider";
import { refreshBookMetadata } from "@rawkoon/api/services/books/refreshBookMetadata";
import { serializePerBook } from "@rawkoon/api/services/books/refreshQueue";
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
  /** Prefer this ISBN over the provider volume's primary identifier. */
  isbn13?: string | null;
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

  // An ISBN search pins the operator's identifier on the search hit. getBook
  // reloads the volume and can replace it with a sibling edition's ISBN_13;
  // keep the typed one when the caller still has it.
  if (opts.isbn13) {
    meta = pinQueriedIsbn(meta, opts.isbn13);
  }

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
        //
        // isbn13 only when this add carried one: re-adding a volume without an
        // ISBN must not replace the operator's identifier with the volume
        // record's primary one, which is regularly a sibling printing's. An
        // empty column is filled by the enrich below.
        ...(opts.isbn13 ? { isbn13: meta.isbn13 } : {}),
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

  // Enrich on add so an unattended add — author monitoring — gets the same
  // metadata a hand-added book does. A failure here must not fail the add: the
  // book exists and can be refreshed later.
  try {
    // Queued like every other refresh: adding a volume that already exists
    // re-runs this, and an unqueued run racing an override save could finish
    // last and overwrite the columns with a stale snapshot.
    await serializePerBook(bookId, () => refreshBookMetadata(bookId));
  } catch (e) {
    console.warn(
      `[books] metadata enrichment failed for book ${bookId}: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
  }

  return { added: true, bookId, created: !existing };
}

/**
 * Add a book straight from scraped metadata, for discovery sources whose titles
 * Google Books does not index (francophone-Québec palmarès books). There is no
 * provider volume, so the row is keyed by a synthetic `googleVolumeId` derived
 * from the ISBN — the column is required and unique, and a real Google id would
 * only exist if Google had the book, which is exactly the case this handles.
 * De-duped by ISBN so it never creates a second row for a book already added
 * through a real Google volume.
 */
export async function addBookFromMetadata(opts: {
  isbn13: string;
  title: string;
  author?: string | null;
  overview?: string | null;
  coverUrl?: string | null;
  publishedYear?: number | null;
  language?: string | null;
  kinds: BookEditionKind[];
  bookQualityProfileId?: number | null;
  monitored?: boolean;
}): Promise<AddBookOutcome> {
  const isbn13 = opts.isbn13.trim();
  const title = opts.title.trim();
  if (!isbn13) return { added: false, reason: "isbn13 is required" };
  if (!title) return { added: false, reason: "title is required" };

  const kinds = opts.kinds.length > 0 ? opts.kinds : (["ebook"] as const);

  // If the book already exists (added earlier via a real Google volume or a
  // previous metadata add), reuse it rather than creating a duplicate row.
  const byIsbn = await prisma.libraryBook.findFirst({
    where: { isbn13 },
    select: { id: true },
  });
  const syntheticId = `leslibraires:${isbn13}`;

  const profileByKind = new Map<BookEditionKind, number | null>();
  for (const kind of kinds) {
    profileByKind.set(
      kind,
      await resolveBookProfileId(kind, opts.bookQualityProfileId),
    );
  }

  const bookId = await prisma.$transaction(async (tx) => {
    const book = byIsbn
      ? await tx.libraryBook.findUniqueOrThrow({
          where: { id: byIsbn.id },
          select: { id: true },
        })
      : await tx.libraryBook.upsert({
          where: { googleVolumeId: syntheticId },
          create: {
            googleVolumeId: syntheticId,
            isbn13,
            title,
            sortTitle: title,
            overview: opts.overview ?? null,
            coverUrl: opts.coverUrl ?? null,
            language: opts.language ?? undefined,
            publishedYear: opts.publishedYear ?? null,
          },
          update: {
            overview: opts.overview ?? null,
            coverUrl: opts.coverUrl ?? null,
          },
        });

    const authorName = opts.author?.trim();
    if (authorName) {
      const author = await tx.author.upsert({
        where: { googleAuthorName: authorName },
        create: { googleAuthorName: authorName, sortName: authorName },
        update: {},
      });
      await tx.bookAuthor.upsert({
        where: {
          authorId_bookId_role: {
            authorId: author.id,
            bookId: book.id,
            role: "author",
          },
        },
        create: { authorId: author.id, bookId: book.id, role: "author" },
        update: {},
      });
    }

    for (const kind of kinds) {
      await tx.bookEdition.upsert({
        where: { bookId_kind: { bookId: book.id, kind } },
        create: {
          bookId: book.id,
          kind,
          monitored: opts.monitored ?? true,
          bookQualityProfileId: profileByKind.get(kind) ?? null,
        },
        update: {},
      });
    }

    return book.id;
  });

  return { added: true, bookId, created: !byIsbn };
}
