/**
 * Book metadata provider contract.
 *
 * There is one implementation (Google Books). The interface exists as cheap
 * insurance against provider rot — the failure mode that killed Readarr — so a
 * future swap is an adapter change rather than a rewrite.
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

export interface BookMetadataProvider {
  readonly source: "googlebooks";
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
