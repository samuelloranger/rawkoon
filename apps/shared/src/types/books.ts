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
  chapter_count: number | null;
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

/* -------------------------------------------------------------------------- */
/* Reading and listening                                                      */
/* -------------------------------------------------------------------------- */

/** Formats a browser can render. mobi and azw3 are downloadable only. */
export const READABLE_EBOOK_FORMATS = ["epub", "pdf", "cbz"] as const;
export type ReadableEbookFormat = (typeof READABLE_EBOOK_FORMATS)[number];

export const isReadableFormat = (
  format: string,
): format is ReadableEbookFormat =>
  (READABLE_EBOOK_FORMATS as readonly string[]).includes(format);

export interface BookChapter {
  index: number;
  title: string | null;
  /** Seconds, relative to the file. */
  start_secs: number;
  end_secs: number;
}

/**
 * One file as the reader and player see it. `offset_secs` is where this file
 * starts on the edition's flattened timeline, so the client never has to sum
 * durations itself.
 */
export interface BookManifestFile {
  id: number;
  file_name: string;
  format: BookFormat;
  size_bytes: string;
  duration_secs: number | null;
  offset_secs: number;
  /** False for mobi and azw3: no browser renderer, download instead. */
  readable: boolean;
  chapters: BookChapter[];
  content_url: string;
}

export interface BookManifest {
  edition_id: number;
  book_id: number;
  kind: BookEditionKind;
  title: string;
  authors: string[];
  narrators: string[];
  cover_url: string | null;
  /** Sum of file durations; null for an ebook edition. */
  total_duration_secs: number | null;
  files: BookManifestFile[];
  /** The file the reader should open: epub > pdf > cbz. Null for audiobooks. */
  primary_file_id: number | null;
  progress: BookProgress | null;
}

export interface BookProgress {
  edition_id: number;
  /** Ebook: an EPUB CFI, or "page:N" for pdf and cbz. */
  locator: string | null;
  percent: number | null;
  /** Audiobook: seconds into the edition's flattened timeline. */
  position_secs: number | null;
  file_id: number | null;
  finished_at: string | null;
  client_updated_at: string;
  updated_at: string;
}

export interface BookProgressWrite {
  locator?: string | null;
  percent?: number | null;
  position_secs?: number | null;
  file_id?: number | null;
  finished?: boolean;
  /** Client clock, ISO 8601. The highest value wins on conflict. */
  client_updated_at: string;
}

export interface BookProgressResponse {
  progress: BookProgress;
  /** False when the write lost to a newer stored position. */
  accepted: boolean;
}

export interface BookProgressListResponse {
  progress: BookProgress[];
}

export interface BookManifestResponse {
  manifest: BookManifest;
}

/**
 * One started, unfinished edition, for the home "Continue reading" widget.
 *
 * Flat on purpose: the widget needs a title, a cover and a position, and
 * fetching a manifest per book to get them would be one request per row.
 */
export interface BookReadingEntry {
  edition_id: number;
  book_id: number;
  kind: BookEditionKind;
  title: string;
  authors: string[];
  cover_url: string | null;
  /** Ebook progress, 0..1. Null for an audiobook. */
  percent: number | null;
  /** The stored position, carried so marking the book finished can keep it. */
  locator: string | null;
  file_id: number | null;
  /** Audiobook position in seconds on the flattened timeline. */
  position_secs: number | null;
  /** Audiobook total, for the remaining-time label. Null for an ebook. */
  total_duration_secs: number | null;
  /** When the position was last written, which is the sort order. */
  updated_at: string;
}

export interface BookReadingResponse {
  reading: BookReadingEntry[];
}
