import { prisma } from "@rawkoon/api/db";
import type { BookMetadataSource } from "@rawkoon/shared/types";
import { normalizeSourceOrder } from "@rawkoon/shared/utils";
import { getAudnexusProvider } from "./audnexusProvider";
import { getBookMetadataProvider } from "./googleBooksProvider";
import { mergeBookMetadata, MERGEABLE_FIELDS } from "./mergeBookMetadata";
import {
  BookProviderUnavailableError,
  type BookMatchInput,
  type BookMetadataProvider,
  type ProviderFields,
} from "./types";

/**
 * Re-runs the source chain for one book and writes the merged result.
 *
 * There is no scheduled sweep by design: metadata changes only when someone
 * asks, so a source that failed is reported back to the caller rather than
 * silently retried later.
 */

export type RefreshMetadataOutcome =
  | {
      ok: true;
      bookId: number;
      changedFields: string[];
      failedSources: BookMetadataSource[];
      usedSources: BookMetadataSource[];
    }
  | { ok: false; reason: string };

/**
 * Merged fields that map to a LibraryBook column.
 *
 * Deliberately excluded, even when a provider supplies them:
 *  - title: it is the indexer search term and may have been hand-corrected.
 *  - language: a property of book identity. LibraryBook.language is set only on
 *    insert by design, and flipping it re-points every indexer search.
 *  - authors: owned by the book_authors join table and its trigger.
 *  - authorBio / authorImageUrl: they belong to Author, not to a book.
 */
const BOOK_COLUMNS = new Set<string>([
  "subtitle",
  "narrators",
  "genres",
  "publisher",
  "pageCount",
  "publishedDate",
  "publishedYear",
  "isbn13",
  "coverUrl",
  "overview",
  "seriesName",
  "seriesPosition",
  "rating",
  "ratingCount",
]);

async function collectProviders(
  order: BookMetadataSource[],
): Promise<BookMetadataProvider[]> {
  const out: BookMetadataProvider[] = [];
  for (const source of order) {
    if (source === "audnexus") {
      const p = await getAudnexusProvider();
      if (p) out.push(p);
    } else if (source === "googlebooks") {
      const p = await getBookMetadataProvider();
      if (p) out.push(p);
    }
    // "local" and "openlibrary" are registered by their own providers.
  }
  return out;
}

export async function refreshBookMetadata(
  bookId: number,
  opts?: { providers?: BookMetadataProvider[] },
): Promise<RefreshMetadataOutcome> {
  const book = await prisma.libraryBook.findUnique({
    where: { id: bookId },
    select: {
      id: true,
      googleVolumeId: true,
      title: true,
      authors: true,
      language: true,
      isbn13: true,
      overrides: true,
      externalIds: { select: { source: true, externalId: true } },
    },
  });
  if (!book) return { ok: false, reason: "Book not found" };

  const settings = await prisma.mediaSettings.findUnique({
    where: { id: 1 },
    select: { bookMetadataSourceOrder: true },
  });
  const order = normalizeSourceOrder(settings?.bookMetadataSourceOrder);

  const externalIds: BookMatchInput["externalIds"] = {};
  for (const row of book.externalIds) {
    externalIds[row.source as BookMetadataSource] = row.externalId;
  }

  const input: BookMatchInput = {
    bookId: book.id,
    title: book.title,
    authors: book.authors,
    language: book.language,
    isbn13: book.isbn13,
    googleVolumeId: book.googleVolumeId,
    externalIds,
  };

  // A provider outside the configured order is dropped here, so an injected
  // provider cannot smuggle itself past the operator's source list.
  const providers = (opts?.providers ?? (await collectProviders(order))).filter(
    (p) => order.includes(p.source),
  );

  const failedSources: BookMetadataSource[] = [];
  const resolvedIds: Array<{ source: BookMetadataSource; externalId: string }> =
    [];

  const settled = await Promise.all(
    providers.map(async (provider) => {
      try {
        const fields = await provider.enrich(input);
        if (fields.__asin) {
          resolvedIds.push({
            source: provider.source,
            externalId: fields.__asin,
          });
        }
        return { source: provider.source, fields };
      } catch (e) {
        // An outage is skipped, never recorded. Recording it would make a
        // transient 503 look like a permanent absence.
        if (e instanceof BookProviderUnavailableError) {
          failedSources.push(provider.source);
          return null;
        }
        throw e;
      }
    }),
  );

  const candidates = settled.filter(
    (c): c is { source: BookMetadataSource; fields: ProviderFields } =>
      c !== null,
  );

  const overrides =
    book.overrides &&
    typeof book.overrides === "object" &&
    !Array.isArray(book.overrides)
      ? (book.overrides as Record<string, unknown>)
      : null;

  const { merged, provenance } = mergeBookMetadata(
    candidates,
    order,
    overrides,
  );

  const data: Record<string, unknown> = {};
  for (const field of MERGEABLE_FIELDS) {
    if (!BOOK_COLUMNS.has(field)) continue;
    if (!(field in merged)) continue;
    const value = merged[field];
    data[field] =
      field === "publishedDate" && typeof value === "string"
        ? new Date(value)
        : value;
  }

  // Provenance is only recorded for fields that actually reached a column, so
  // the tooltip cannot claim a source for something the book does not show.
  const provenanceRows = Object.entries(provenance)
    .filter(([field]) => BOOK_COLUMNS.has(field))
    .map(([field, source]) => ({ bookId: book.id, field, source }));

  await prisma.$transaction(async (tx) => {
    if (Object.keys(data).length > 0) {
      await tx.libraryBook.update({ where: { id: book.id }, data });
    }
    for (const { source, externalId } of resolvedIds) {
      await tx.bookExternalId.upsert({
        where: { bookId_source: { bookId: book.id, source } },
        create: { bookId: book.id, source, externalId },
        update: { externalId, fetchedAt: new Date() },
      });
    }
    // Replaced wholesale: a field that no longer resolves must lose its stale
    // provenance row rather than keep claiming a source.
    await tx.bookMetadataField.deleteMany({ where: { bookId: book.id } });
    if (provenanceRows.length > 0) {
      await tx.bookMetadataField.createMany({ data: provenanceRows });
    }
  });

  return {
    ok: true,
    bookId: book.id,
    changedFields: Object.keys(data),
    failedSources,
    usedSources: [...new Set(candidates.map((c) => c.source))],
  };
}
