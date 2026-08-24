import type { BookMetadataSource } from "@rawkoon/shared/types";

/**
 * Book metadata provider contract.
 *
 * The interface exists as cheap insurance against provider rot — the failure
 * mode that killed Readarr — so a swap is an adapter change, not a rewrite.
 *
 * It splits along a seam the original single-provider version conflated:
 * searching for identity and filling fields for an already-known book are
 * different operations with different callers. Only Google Books implements the
 * identity half; every provider implements `enrich`.
 */

export interface ProviderBook {
  /** Google Books volume id. The book's identity. */
  volumeId: string;
  title: string;
  subtitle: string | null;
  authors: string[];
  /** ISO 639-1. */
  language: string;
  publishedYear: number | null;
  isbn13: string | null;
  coverUrl: string | null;
  overview: string | null;
  seriesName: string | null;
  seriesPosition: number | null;
}

/**
 * A sparse contribution from one source.
 *
 * Absent key vs null is load-bearing: absent means "this source has nothing to
 * say", null means "this source asserts empty". Without the distinction a
 * high-priority source that simply lacks a field would blank a value a
 * lower-priority source knows.
 */
export interface ProviderFields {
  title?: string | null;
  subtitle?: string | null;
  authors?: string[];
  narrators?: string[];
  genres?: string[];
  publisher?: string | null;
  pageCount?: number | null;
  /** ISO-8601 date string. Stored to LibraryBook.publishedDate. */
  publishedDate?: string | null;
  publishedYear?: number | null;
  isbn13?: string | null;
  coverUrl?: string | null;
  overview?: string | null;
  seriesName?: string | null;
  seriesPosition?: number | null;
  /** ISO 639-1. */
  language?: string | null;
  rating?: number | null;
  ratingCount?: number | null;
  authorBio?: string | null;
  authorImageUrl?: string | null;
  /** Internal: the id this source resolved. Stripped before storage. */
  __asin?: string;
}

/** Every key resolved. Same shape; a distinct name so intent reads clearly. */
export type MergedBookFields = ProviderFields;

/** What a provider needs in order to enrich a book it did not find itself. */
export interface BookMatchInput {
  bookId: number;
  title: string;
  authors: string[];
  /** ISO 639-1. */
  language: string;
  isbn13: string | null;
  googleVolumeId: string;
  /** Already-resolved ids, keyed by source. Lets enrich skip re-resolution. */
  externalIds: Partial<Record<BookMetadataSource, string>>;
}

/**
 * What every source can do: contribute fields for a book already in the
 * library. This is all the merge needs.
 */
export interface BookMetadataProvider {
  readonly source: BookMetadataSource;
  enrich(book: BookMatchInput): Promise<ProviderFields>;
}

/**
 * A provider that can also establish identity — find a book that is not in the
 * library yet. Only Google Books does this, and the add flow, the import script
 * and author monitoring all require it.
 *
 * Kept as a separate interface rather than optional methods on
 * BookMetadataProvider: those callers cannot proceed without a search, so
 * making the methods optional would push a meaningless `?.` onto every one of
 * them and lose the guarantee at the type level.
 */
export interface BookIdentityProvider extends BookMetadataProvider {
  /** Free-text-ish search for the add flow. Uses structured operators. */
  searchBooks(
    query: string,
    opts?: { limit?: number },
  ): Promise<ProviderBook[]>;
  getBook(volumeId: string): Promise<ProviderBook | null>;
  resolveIsbn(isbn13: string): Promise<ProviderBook | null>;
  /**
   * `languages` are ISO 639-1 codes. Google only accepts one `langRestrict` per
   * request, so several codes mean several requests merged by volume id —
   * without it a French-only follow returns nothing, because `inauthor:` ranks
   * the English editions into the whole result window.
   */
  getAuthorBooks(
    authorName: string,
    opts?: { limit?: number; languages?: string[] },
  ): Promise<ProviderBook[]>;
}

/**
 * Raised when the provider failed rather than found nothing.
 *
 * This distinction is load-bearing. Google Books returns HTTP 503
 * `backendFailed` nondeterministically for perfectly valid queries — the same
 * ISBN URL was observed failing three times and then succeeding. Collapsing
 * that into an empty result would let a transient blip look like "this book
 * does not exist", and caching it would make the book permanently unfindable.
 *
 * Callers must therefore never cache this and never treat it as "not found".
 */
export class BookProviderUnavailableError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "BookProviderUnavailableError";
  }
}
