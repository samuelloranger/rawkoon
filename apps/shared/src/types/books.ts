/**
 * Books and audiobooks.
 *
 * A book is exactly one Google Books volume, so `title` is always the title
 * trackers use — there is no searchTitle indirection like LibraryMedia needs.
 * A translation and its original are two independent books.
 */

export type BookEditionKind = "ebook" | "audiobook";

export type BookEditionStatus =
  | "wanted"
  | "downloading"
  | "downloaded"
  | "skipped"
  | "upgrading";

export type EbookFormat = "epub" | "azw3" | "mobi" | "pdf" | "cbz";
export type AudiobookFormat = "m4b" | "mp3" | "flac" | "ogg";
export type BookFormat = EbookFormat | AudiobookFormat;

export interface BookQualityProfileRef {
  id: number;
  name: string;
}

export interface BookFileInfo {
  id: number;
  file_name: string;
  file_path: string;
  size_bytes: string;
  format: BookFormat;
  duration_secs: number | null;
  audio_bitrate: number | null;
  audio_codec: string | null;
  /** false means "unknown or scan", never "confirmed scan". */
  is_retail: boolean;
  release_group: string | null;
  language_tags: string[];
  scanned_at: string;
}

export interface BookEdition {
  id: number;
  kind: BookEditionKind;
  status: BookEditionStatus;
  monitored: boolean;
  book_quality_profile_id: number | null;
  book_quality_profile: BookQualityProfileRef | null;
  /** Audiobook only; from container tags at import, not the metadata provider. */
  narrators: string[];
  duration_secs: number | null;
  search_attempts: number;
  last_grabbed_at: string | null;
  total_size_bytes: string | null;
  file_count: number;
  /** Best-ranked format among this edition's files; null when it has none. */
  best_format: BookFormat | null;
}

export interface Book {
  id: number;
  google_volume_id: string;
  isbn13: string | null;
  title: string;
  sort_title: string | null;
  subtitle: string | null;
  overview: string | null;
  cover_url: string | null;
  authors: string[];
  /** ISO 639-1. A property of the book, not the edition. */
  language: string;
  published_year: number | null;
  series_name: string | null;
  series_position: number | null;
  added_at: string;
  updated_at: string;
  overrides?: Record<string, unknown>;
  editions: BookEdition[];
}

export interface BookListResponse {
  items: Book[];
  total: number;
  has_more: boolean;
}

export interface BookItemResponse {
  item: Book;
}

export interface BookFilesResponse {
  edition_id: number;
  kind: BookEditionKind;
  files: BookFileInfo[];
}

/** A search hit from the metadata provider, before it becomes a library book. */
export interface BookSearchResult {
  google_volume_id: string;
  title: string;
  subtitle: string | null;
  authors: string[];
  language: string;
  published_year: number | null;
  isbn13: string | null;
  cover_url: string | null;
  overview: string | null;
  /** True when this volume is already in the library. */
  in_library: boolean;
  library_book_id: number | null;
}

export interface BookSearchResponse {
  results: BookSearchResult[];
}

export interface AddBookRequest {
  google_volume_id: string;
  /** Which editions to create and monitor. Defaults to ["ebook"]. */
  kinds?: BookEditionKind[];
  book_quality_profile_id?: number | null;
  monitored?: boolean;
}

/**
 * A candidate release from the indexer, scored for one edition.
 * `kind` is derived from the parsed format and size, NOT the indexer category —
 * real audiobook releases turn up filed under the Books category.
 */
export interface BookRelease {
  guid: string;
  title: string;
  indexer: string | null;
  size_bytes: number | null;
  seeders: number | null;
  leechers: number | null;
  age: number | null;
  download_url: string | null;
  magnet_url: string | null;
  /** Parsed from the release title. */
  format: BookFormat | null;
  kind: BookEditionKind | null;
  audio_bitrate: number | null;
  language: string | null;
  release_group: string | null;
  is_retail: boolean;
  score: number;
  rejected: boolean;
  rejections: string[];
}

export interface BookReleaseSearchResponse {
  releases: BookRelease[];
  indexer_warnings: { id: string; name: string; error: string }[];
}

export interface BookGrabResponse {
  grabbed: boolean;
  release_title?: string;
  reason?: string;
}

export interface BookQualityProfile {
  id: number;
  name: string;
  kind: "ebook" | "audiobook" | "both";
  /** Ordered preference; first entry is best. */
  allowed_formats: BookFormat[];
  cutoff_format: BookFormat | null;
  prefer_retail: boolean;
  max_size_mb: number | null;
  min_seeders: number;
  min_audio_bitrate: number | null;
  preferred_languages: string[];
  prioritized_trackers: string[];
  prefer_tracker_over_quality: boolean;
  created_at: string;
  updated_at: string;
}

export interface BookQualityProfileListResponse {
  profiles: BookQualityProfile[];
}

/**
 * A monitored author.
 *
 * Identity is the provider's author name — Google Books exposes no author id,
 * so homonymous authors collide. `monitor_edition_kinds` is empty for an
 * unmonitored author and decides which editions new titles get.
 */
export interface Author {
  id: number;
  name: string;
  sort_name: string | null;
  image_url: string | null;
  bio: string | null;
  monitored: boolean;
  /** Only titles published in or after this year are added. */
  monitor_from: string | null;
  monitor_edition_kinds: BookEditionKind[];
  /**
   * ISO 639-1 codes a new title must be in to be added. Empty means any
   * language. Language is a property of the book, not of the edition, so this
   * is the only way to follow an author without collecting every translation.
   */
  monitor_languages: string[];
  book_quality_profile_id: number | null;
  last_checked_at: string | null;
  /** Books in the library credited to this author. */
  book_count: number;
}

export interface AuthorListResponse {
  authors: Author[];
}

export interface AuthorResponse {
  author: Author;
}

/**
 * A metadata source, in the order the merge considers them by default.
 * "local" is on-disk file metadata: the operator can fix a file with a tagger
 * and rescan, so it must outrank every remote source or that repair would be
 * silently reverted on the next refresh.
 */
export type BookMetadataSource =
  | "local"
  | "audnexus"
  | "googlebooks"
  | "openlibrary";
