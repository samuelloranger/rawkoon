import { prisma } from "@rawkoon/api/db";
import type { BookMetadataSource } from "@rawkoon/shared/types";
import { normalizeSourceOrder } from "@rawkoon/shared/utils";
import { getAudnexusProvider } from "./audnexusProvider";
import { getBookMetadataProvider, toIsbn13 } from "./googleBooksProvider";
import { getLocalFileProvider } from "./localFileProvider";
import { getOpenLibraryProvider } from "./openLibraryProvider";
import { mergeBookMetadata, MERGEABLE_FIELDS } from "./mergeBookMetadata";
import { authorProfileFill } from "./authorProfile";
import {
  BookProviderUnavailableError,
  type BookIdentityProvider,
  type BookMatchInput,
  type BookMetadataProvider,
  type ProviderBook,
  type ProviderFields,
} from "./types";

/** Re-runs the source chain for one book; there is no scheduled sweep, so failed sources are reported to the caller. */

export type RefreshMetadataOutcome =
  | {
      ok: true;
      bookId: number;
      changedFields: string[];
      failedSources: BookMetadataSource[];
      usedSources: BookMetadataSource[];
      /** Cleared overrides on non-emptiable columns with no replacement; the caller must restore the override. */
      unrestoredFields: string[];
    }
  | { ok: false; reason: string };

/** Only an operator override may re-point identity; the provider-written isbn13 column drifts to other editions. */
function effectiveIsbn(
  overrides: Record<string, unknown> | null,
  cleared: Set<string>,
): string | null {
  if (cleared.has("isbn13")) return null;
  const fromOverride = overrides?.isbn13;
  if (typeof fromOverride !== "string" || !fromOverride.trim()) return null;
  return toIsbn13(fromOverride);
}

/** Rebinds to the Google volume carrying the ISBN; strict because `isbn:` returns a whole edition cluster. */
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

/** Columns no provider may write (untrusted data) but an operator override may. */
const OVERRIDE_ONLY_COLUMNS = new Set<string>(["title", "language"]);

/** A book needs a title and language is NOT NULL, so clearing these keeps the current value. */
const NEVER_EMPTIED_COLUMNS = new Set<string>(["title", "language"]);

/** List columns are required by Prisma even though Postgres accepts null, so they empty to []. */
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

/** Arrays compare element-wise and dates by instant; `!==` would report a change on every refresh. */
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
      out.push(getLocalFileProvider());
    } else if (source === "openlibrary") {
      out.push(getOpenLibraryProvider());
    }
  }
  return out;
}

export async function refreshBookMetadata(
  bookId: number,
  opts?: {
    providers?: BookMetadataProvider[];
    identityProvider?: BookIdentityProvider | null;
    /** Override keys removed by this request, so their columns get re-authorised or emptied. */
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
      // Provenance owners, to protect a failing source's fields.
      metadataFields: { select: { field: true, source: true } },
      // Current values, so only real differences are written.
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

  // Before enrich so providers see the new identity; gated on googlebooks so a disabled Google can't rewrite it.
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

  // Drop providers outside the configured order so an injected one can't bypass it.
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
        // An outage is skipped, not recorded: a transient 503 must not look like absence.
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

  /** Fields owned by a failing source keep value and provenance, so an outage neither strips them nor lets a lower source overwrite. */
  const failed = new Set<string>(failedSources);
  const currentProvenance = new Map<string, string>(
    book.metadataFields.map((f) => [f.field, f.source]),
  );
  // An override outranks the lock on a down source, or editing would silently do nothing.
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
    // Write only differences, or every refresh reports changes and churns updatedAt.
    if (!sameValue(current[field], next)) data[field] = next;
  }

  // A cleared override no source replaces must be emptied, or the column keeps a value no longer marked as manual.
  for (const field of cleared) {
    if (field in merged) continue;
    if (!BOOK_COLUMNS.has(field) && !OVERRIDE_ONLY_COLUMNS.has(field)) continue;
    if (lockedFields.has(field)) continue;
    // A non-nullable column can't be emptied; report it so the caller restores the override.
    if (NEVER_EMPTIED_COLUMNS.has(field)) {
      unrestoredFields.push(field);
      continue;
    }
    const empty = EMPTY_VALUE[field] ?? null;
    if (sameValue(current[field], empty)) continue;
    data[field] = empty;
  }

  // Empty columns whose supplier answered but stopped claiming them; failing or disabled sources keep theirs.
  const answered = new Set<BookMetadataSource>(candidates.map((c) => c.source));
  for (const [field, source] of currentProvenance) {
    if (!answered.has(source as BookMetadataSource)) continue;
    if (!BOOK_COLUMNS.has(field)) continue;
    if (overridden.has(field) || lockedFields.has(field)) continue;
    if (field in merged) continue;
    const empty = EMPTY_VALUE[field] ?? null;
    if (sameValue(current[field], empty)) continue;
    data[field] = empty;
  }

  // Provenance only for mapped columns, plus untouched rows of failing sources.
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

  /** Title and language follow a rebind unless overridden; built per attempt so a lost volume-id race can drop them. */
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
      // Replaced wholesale so a field that no longer resolves loses its stale provenance row.
      await tx.bookMetadataField.deleteMany({ where: { bookId: book.id } });
      if (provenanceRows.length > 0) {
        await tx.bookMetadataField.createMany({ data: provenanceRows });
      }
    });
    return write;
  };

  // googleVolumeId is unique and the clash check is advisory, so a lost race raises P2002; retry without the identity change.
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

  await enrichPrimaryAuthor(book.authors, providers);

  return {
    ok: true,
    bookId: book.id,
    changedFields: Object.keys(written),
    unrestoredFields,
    failedSources,
    usedSources: [...new Set(candidates.map((c) => c.source))],
  };
}

/** Best-effort, fill-only author bio/image after the book write, since author rows are shared across books. */
async function enrichPrimaryAuthor(
  authors: string[],
  providers: BookMetadataProvider[],
): Promise<void> {
  const name = authors[0];
  if (!name) return;

  const author = await prisma.author.findUnique({
    where: { googleAuthorName: name },
    select: { id: true, bio: true, imageUrl: true },
  });
  if (!author) return;
  if (author.bio && author.imageUrl) return;

  const provider = providers.find((p) => p.enrichAuthor);
  if (!provider?.enrichAuthor) return;

  let fields: ProviderFields;
  try {
    fields = await provider.enrichAuthor(name);
  } catch (e) {
    // A provider outage must not fail the book refresh that just succeeded.
    if (e instanceof BookProviderUnavailableError) return;
    throw e;
  }

  const patch = authorProfileFill(author, {
    bio: fields.authorBio,
    imageUrl: fields.authorImageUrl,
  });
  if (Object.keys(patch).length === 0) return;
  await prisma.author.update({ where: { id: author.id }, data: patch });
}
