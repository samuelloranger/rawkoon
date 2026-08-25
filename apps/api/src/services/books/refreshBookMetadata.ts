import { prisma } from "@rawkoon/api/db";
import type { BookMetadataSource } from "@rawkoon/shared/types";
import { normalizeSourceOrder } from "@rawkoon/shared/utils";
import { getAudnexusProvider } from "./audnexusProvider";
import { getBookMetadataProvider, toIsbn13 } from "./googleBooksProvider";
import { getLocalFileProvider } from "./localFileProvider";
import { getOpenLibraryProvider } from "./openLibraryProvider";
import { mergeBookMetadata, MERGEABLE_FIELDS } from "./mergeBookMetadata";
import {
  BookProviderUnavailableError,
  type BookIdentityProvider,
  type BookMatchInput,
  type BookMetadataProvider,
  type ProviderBook,
  type ProviderFields,
} from "./types";

/**
 * Re-runs the source chain for one book and writes the merged result.
 *
 * There is no scheduled sweep by design: metadata changes only when someone
 * asks, so a source that failed is reported back to the caller rather than
 * silently retried later.
 *
 * An *overridden* ISBN that no longer matches the stored googleVolumeId rebinds
 * identity first: resolveIsbn picks the edition, googleVolumeId and language
 * follow it, and a stale Audnexus ASIN is dropped so narrators/series
 * re-resolve for the new edition rather than keeping the previous one's record.
 */

export type RefreshMetadataOutcome =
  | {
      ok: true;
      bookId: number;
      changedFields: string[];
      failedSources: BookMetadataSource[];
      usedSources: BookMetadataSource[];
      /**
       * Cleared overrides on columns that cannot be emptied, where no source
       * supplied a replacement. The caller must put the override back: the
       * column still holds the manual value, and leaving it with no override
       * marker would strand it, with no Revert action and no later refresh
       * able to repair it.
       */
      unrestoredFields: string[];
    }
  | { ok: false; reason: string };

/**
 * The ISBN allowed to re-point identity: an operator override, and nothing
 * else.
 *
 * Deliberately not the isbn13 column. Providers write that column, so trusting
 * it turns provider drift into an identity change: a book added by title has no
 * ISBN, Audnexus fills one — regularly an Audible product code for another
 * language's edition of the same title — and the next refresh would rebind the
 * book to that edition's volume. An override is the only ISBN a person
 * asserted.
 *
 * An override being reverted by this very request is already gone from the JSON
 * while the column still holds its value, so it must not rebind either: that
 * would re-point the book at the edition the operator just abandoned.
 */
function effectiveIsbn(
  overrides: Record<string, unknown> | null,
  cleared: Set<string>,
): string | null {
  if (cleared.has("isbn13")) return null;
  const fromOverride = overrides?.isbn13;
  if (typeof fromOverride !== "string" || !fromOverride.trim()) return null;
  return toIsbn13(fromOverride);
}

/**
 * When the book's ISBN points at a different Google volume than the one we
 * store, rebind. Returns null when there is nothing to do, no exact match, or
 * the target volume already belongs to another library book.
 *
 * Resolution is strict: only a volume that actually carries the ISBN may take
 * over a book's identity. Google's `isbn:` query answers with the whole
 * edition cluster, so a loose pick would re-point title, language and cover at
 * an arbitrary sibling and then stamp the queried ISBN on it.
 */
async function rebindIdentityFromIsbn(
  book: { id: number; googleVolumeId: string },
  isbn: string,
  identity: BookIdentityProvider,
): Promise<ProviderBook | null> {
  let resolved: ProviderBook | null;
  try {
    resolved = await identity.resolveIsbn(isbn, { strict: true });
  } catch (e) {
    if (e instanceof BookProviderUnavailableError) return null;
    throw e;
  }
  if (!resolved || resolved.volumeId === book.googleVolumeId) return null;

  const clash = await prisma.libraryBook.findFirst({
    where: {
      googleVolumeId: resolved.volumeId,
      NOT: { id: book.id },
    },
    select: { id: true },
  });
  if (clash) {
    console.warn(
      `[books] ISBN ${isbn} resolves to volume ${resolved.volumeId}, already used by book ${clash.id} — keeping current identity`,
    );
    return null;
  }
  return resolved;
}

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

/**
 * Columns that can never be emptied.
 *
 * A book must have a title, and language is NOT NULL with a default. Clearing
 * an override on either falls back to the source value when there is one, and
 * otherwise keeps what is there — an empty title is not a state this app has.
 */
const NEVER_EMPTIED_COLUMNS = new Set<string>(["title", "language"]);

/**
 * What "empty" means per column. List columns are required by the Prisma
 * client even though Postgres would accept null, so they empty to [].
 */
const EMPTY_VALUE: Record<string, unknown> = {
  narrators: [],
  genres: [],
};

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
     * Optional identity provider for ISBN rebind. Tests inject it; production
     * falls back to the configured Google Books provider.
     */
    identityProvider?: BookIdentityProvider | null;
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

  const overrides =
    book.overrides &&
    typeof book.overrides === "object" &&
    !Array.isArray(book.overrides)
      ? (book.overrides as Record<string, unknown>)
      : null;

  const cleared = new Set<string>(opts?.clearedOverrides ?? []);

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

  // Before enrich, so every provider sees the new identity. Gated on the
  // source order for the same reason the provider list below is: with
  // googlebooks disabled, Google must not get to rewrite volumeId, title and
  // language through the back door.
  const isbn = effectiveIsbn(overrides, cleared);
  let rebound: ProviderBook | null = null;
  if (isbn && order.includes("googlebooks")) {
    const identity =
      opts?.identityProvider !== undefined
        ? opts.identityProvider
        : await getBookMetadataProvider();
    if (identity) {
      rebound = await rebindIdentityFromIsbn(book, isbn, identity);
      if (rebound) {
        input.googleVolumeId = rebound.volumeId;
        input.externalIds = {
          ...input.externalIds,
          googlebooks: rebound.volumeId,
        };
        // Drop the stale ASIN: it belongs to the previous edition/language.
        delete input.externalIds.audnexus;
        input.isbn13 = rebound.isbn13 ?? isbn;
        input.language = rebound.language;
        input.title = rebound.title;
        if (rebound.authors.length > 0) input.authors = rebound.authors;
      }
    }
  }

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
  const lockedFields = new Set<string>(
    [...currentProvenance.entries()]
      .filter(([field, source]) => failed.has(source) && !overridden.has(field))
      .map(([field]) => field),
  );

  const current = book as unknown as Record<string, unknown>;

  const unrestoredFields: string[] = [];
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
    // A column that cannot hold null needs its own empty value, or the write
    // fails *after* the override has already been deleted — leaving a manual
    // value the book no longer records as manual and a 500 in the operator's
    // face.
    if (NEVER_EMPTIED_COLUMNS.has(field)) {
      unrestoredFields.push(field);
      continue;
    }
    const empty = EMPTY_VALUE[field] ?? null;
    if (sameValue(current[field], empty)) continue;
    data[field] = empty;
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

  /**
   * ISBN rebind is an intentional identity change, so title and language — which
   * a normal refresh must never flip — follow the new edition unless the
   * operator has overridden them.
   *
   * Built per attempt rather than folded into `data`, so losing the race for
   * the volume id can drop the identity columns and still write everything
   * else.
   */
  const identityWrites = (reb: ProviderBook): Record<string, unknown> => {
    const out: Record<string, unknown> = { googleVolumeId: reb.volumeId };
    if (!overridden.has("title") && !sameValue(book.title, reb.title)) {
      out.title = reb.title;
      out.sortTitle = reb.title;
    }
    if (
      !overridden.has("language") &&
      !sameValue(book.language, reb.language)
    ) {
      out.language = reb.language;
    }
    return out;
  };

  const runWrites = async (
    reb: ProviderBook | null,
  ): Promise<Record<string, unknown>> => {
    const write = reb ? { ...data, ...identityWrites(reb) } : data;
    await prisma.$transaction(async (tx) => {
      if (Object.keys(write).length > 0) {
        await tx.libraryBook.update({ where: { id: book.id }, data: write });
      }
      if (reb) {
        // The previous edition's ASIN must not keep winning narrators/series.
        await tx.bookExternalId.deleteMany({
          where: { bookId: book.id, source: "audnexus" },
        });
        await tx.bookExternalId.upsert({
          where: {
            bookId_source: { bookId: book.id, source: "googlebooks" },
          },
          create: {
            bookId: book.id,
            source: "googlebooks",
            externalId: reb.volumeId,
          },
          update: { externalId: reb.volumeId, fetchedAt: new Date() },
        });
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
    return write;
  };

  /**
   * googleVolumeId is unique and the queue only serializes per book, so the
   * clash check above is advisory: two books refreshing toward the same volume
   * both pass it and the loser's update raises P2002 — which onError would
   * report as a bare 500. Retry without the identity change instead.
   */
  let written: Record<string, unknown>;
  try {
    written = await runWrites(rebound);
  } catch (e) {
    if (!rebound || (e as { code?: string }).code !== "P2002") throw e;
    console.warn(
      `[books] volume ${rebound.volumeId} was claimed by another book while refreshing book ${book.id} — keeping current identity`,
    );
    written = await runWrites(null);
  }

  return {
    ok: true,
    bookId: book.id,
    changedFields: Object.keys(written),
    unrestoredFields,
    failedSources,
    usedSources: [...new Set(candidates.map((c) => c.source))],
  };
}
