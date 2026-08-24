import { prisma } from "@rawkoon/api/db";
import type { BookMetadataSource } from "@rawkoon/shared/types";
import { normalizeSourceOrder } from "@rawkoon/shared/utils";
import { getAudnexusProvider } from "./audnexusProvider";
import { getBookMetadataProvider } from "./googleBooksProvider";
import { getLocalFileProvider } from "./localFileProvider";
import { getOpenLibraryProvider } from "./openLibraryProvider";
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
/**
 * Columns no *provider* may write, but an operator override may.
 *
 * The reasons they are protected are all about untrusted provider data: the
 * title is the indexer search term, and language re-points every indexer
 * search. A person editing the field deliberately is the case those rules
 * exist to protect, not the case they are meant to block — fixing a title or a
 * language a provider got wrong is precisely why overrides exist.
 */
const OVERRIDE_ONLY_COLUMNS = new Set<string>(["title", "language"]);

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

/**
 * Whether a stored column value and a freshly merged one are the same.
 *
 * Arrays are compared element-wise and dates by instant: `!==` on either would
 * report a change on every single refresh.
 */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a instanceof Date && b instanceof Date)
    return a.getTime() === b.getTime();
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }
  // Prisma returns null for an empty column; a provider may offer undefined.
  if (a == null && b == null) return true;
  return false;
}

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
    } else if (source === "local") {
      // Always available: it needs no configuration, only files on disk.
      out.push(getLocalFileProvider());
    } else if (source === "openlibrary") {
      // Also keyless.
      out.push(getOpenLibraryProvider());
    }
  }
  return out;
}

export async function refreshBookMetadata(
  bookId: number,
  opts?: {
    providers?: BookMetadataProvider[];
    /**
     * Override keys removed by this request.
     *
     * Two things depend on knowing them. An override-only column (title,
     * language) has to be re-authorised for one run, or the reverted value
     * would stay frozen at whatever the operator typed — no provider may write
     * that column. And a cleared field that no source supplies has to be
     * emptied outright; leaving it would show a manual value the book no longer
     * records as manual, with no way left to remove it.
     */
    clearedOverrides?: string[];
  },
): Promise<RefreshMetadataOutcome> {
  const book = await prisma.libraryBook.findUnique({
    where: { id: bookId },
    select: {
      id: true,
      googleVolumeId: true,
      title: true,
      authors: true,
      language: true,
      overrides: true,
      externalIds: { select: { source: true, externalId: true } },
      // Which source owns each field today. Needed to protect the provenance
      // of a source that is failing right now.
      metadataFields: { select: { field: true, source: true } },
      // Current values of every writable column, so a refresh can report and
      // write only what actually differs.
      subtitle: true,
      narrators: true,
      genres: true,
      publisher: true,
      pageCount: true,
      publishedDate: true,
      publishedYear: true,
      isbn13: true,
      coverUrl: true,
      overview: true,
      seriesName: true,
      seriesPosition: true,
      rating: true,
      ratingCount: true,
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

  /**
   * Fields owned by a source that is failing right now are left completely
   * alone — value and provenance both.
   *
   * Without this, an outage is destructive in two ways: the wholesale
   * provenance delete would strip the failing source's rows, so a value it had
   * supplied would start rendering as "set by hand"; and a lower-priority
   * source would win the field for this run and overwrite the better value.
   * Neither is acceptable for a transient 503.
   */
  const failed = new Set<string>(failedSources);
  const currentProvenance = new Map<string, string>(
    book.metadataFields.map((f) => [f.field, f.source]),
  );
  // An operator override outranks everything, including the protection given
  // to a source that is currently down — otherwise editing a field while that
  // source is unreachable would silently do nothing.
  const overridden = new Set<string>(overrides ? Object.keys(overrides) : []);
  const cleared = new Set<string>(opts?.clearedOverrides ?? []);
  const lockedFields = new Set<string>(
    [...currentProvenance.entries()]
      .filter(([field, source]) => failed.has(source) && !overridden.has(field))
      .map(([field]) => field),
  );

  const current = book as unknown as Record<string, unknown>;

  const data: Record<string, unknown> = {};
  for (const field of MERGEABLE_FIELDS) {
    const writable =
      BOOK_COLUMNS.has(field) ||
      (OVERRIDE_ONLY_COLUMNS.has(field) &&
        (overridden.has(field) || cleared.has(field)));
    if (!writable) continue;
    if (lockedFields.has(field)) continue;
    if (!(field in merged)) continue;
    const value = merged[field];
    const next =
      field === "publishedDate" && typeof value === "string"
        ? new Date(value)
        : value;
    // Only write what actually differs. An unconditional write reports every
    // merged column as "changed" on every refresh and churns updatedAt.
    if (!sameValue(current[field], next)) data[field] = next;
  }

  /**
   * A cleared override the source chain cannot replace.
   *
   * The loop above only writes fields present in `merged`, so a manually added
   * value that no provider supplies would survive its own removal: the column
   * would keep showing it while `overrides` no longer marked it as edited,
   * leaving the UI nothing to revert and no way to clear it.
   */
  for (const field of cleared) {
    if (field in merged) continue;
    if (!BOOK_COLUMNS.has(field) && !OVERRIDE_ONLY_COLUMNS.has(field)) continue;
    if (lockedFields.has(field)) continue;
    if (current[field] == null) continue;
    data[field] = null;
  }

  /**
   * Provenance for this run: what the merge resolved, plus the untouched rows
   * of any failing source. Recorded only for fields that map to a column, so
   * the tooltip cannot claim a source for something the book does not show.
   */
  const nextProvenance = new Map<string, string>();
  for (const [field, source] of currentProvenance) {
    if (lockedFields.has(field)) nextProvenance.set(field, source);
  }
  for (const [field, source] of Object.entries(provenance)) {
    if (!BOOK_COLUMNS.has(field) || lockedFields.has(field)) continue;
    nextProvenance.set(field, source);
  }
  const provenanceRows = [...nextProvenance.entries()].map(
    ([field, source]) => ({ bookId: book.id, field, source }),
  );

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
