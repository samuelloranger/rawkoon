import type { BookMetadataSource } from "@rawkoon/shared/types";

/** Book metadata provider contract; a provider swap is an adapter change, not a rewrite. */

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

/** Absent key means "no say"; null means "asserts empty", so a lacking high-priority source can't blank a lower one's value. */
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

export type MergedBookFields = ProviderFields;

export interface BookMatchInput {
  bookId: number;
  title: string;
  authors: string[];
  /** ISO 639-1. */
  language: string;
  isbn13: string | null;
  googleVolumeId: string;
  externalIds: Partial<Record<BookMetadataSource, string>>;
}

/** What every source can do: contribute fields for a book already in the library. */
export interface BookMetadataProvider {
  readonly source: BookMetadataSource;
  enrich(book: BookMatchInput): Promise<ProviderFields>;
  /** Only Audnexus carries author records, hence optional. */
  enrichAuthor?(authorName: string): Promise<ProviderFields>;
}

/** Provider that can also find books not yet in the library; separate interface so callers keep the guarantee at the type level. */
export interface BookIdentityProvider extends BookMetadataProvider {
  searchBooks(
    query: string,
    opts?: { limit?: number },
  ): Promise<ProviderBook[]>;
  getBook(volumeId: string): Promise<ProviderBook | null>;
  /** `strict` requires a volume that actually carries the ISBN; identity changes must pass it. */
  resolveIsbn(
    isbn13: string,
    opts?: { strict?: boolean },
  ): Promise<ProviderBook | null>;
  /** Google takes one `langRestrict` per request, so several codes merge several requests by volume id. */
  getAuthorBooks(
    authorName: string,
    opts?: { limit?: number; languages?: string[] },
  ): Promise<ProviderBook[]>;
}

/** Provider failed rather than found nothing (Google returns transient 503s); never cache it or treat it as "not found". */
export class BookProviderUnavailableError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "BookProviderUnavailableError";
  }
}

/** One Audible catalog product, mapped; Audnexus has no title search so every ASIN starts here. */
export interface AsinCandidate {
  asin: string;
  title: string;
  subtitle: string | null;
  authors: string[];
  narrators: string[];
  seriesName: string | null;
  seriesPosition: number | null;
  /** As the provider spells it: "french", "english". Not ISO 639-1. */
  language: string | null;
  runtimeMin: number | null;
  publisher: string | null;
  releaseDate: string | null;
  coverUrl: string | null;
  genres: string[];
}

export interface AsinWant {
  title: string;
  authors: string[];
  /** ISO 639-1. */
  language: string;
}

export interface AsinMatch {
  candidate: AsinCandidate;
  score: number;
}
