/** A book is one Google Books volume; a translation and its original are independent books. */

import type { MediaRequestStatus } from "./request";

export type BookEditionKind = "ebook" | "audiobook";

type BookEditionStatus =
  | "wanted"
  | "downloading"
  | "downloaded"
  | "skipped"
  | "upgrading";

export type EbookFormat = "epub" | "azw3" | "mobi" | "pdf" | "cbz";
export type AudiobookFormat = "m4b" | "mp3" | "flac" | "ogg";
export type BookFormat = EbookFormat | AudiobookFormat;

interface BookQualityProfileRef {
  id: number;
  name: string;
}

interface BookFileInfo {
  id: number;
  file_name: string;
  file_path: string;
  /** Signed URL for temporary direct content access. */
  content_url?: string;
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
  /** Audiobook transport gate: chapter files registered. Ebooks are false. */
  offline_ready: boolean;
}

export interface BookManifestChapter {
  index: number;
  title: string;
  start_secs: number;
  end_secs: number;
  file_id: number;
  size_bytes: number;
  sha256: string | null;
  url: string;
}

export interface BookManifestFile {
  id: number;
  /** Whole-book position (secs) where this file's t=0 sits. */
  start_secs: number;
  /** Playable length of the file in secs. */
  duration_secs: number;
  size_bytes: number;
  sha256: string | null;
  url: string;
  /** The Content-Type the grant URL serves, which its extensionless path can't tell. */
  mime_type: string;
}

export interface BookManifest {
  edition_id: number;
  book_id: number;
  title: string;
  authors: string[];
  total_duration_secs: number;
  files: BookManifestFile[];
  chapters: BookManifestChapter[];
}

export interface BookListeningProgress {
  edition_id: number;
  book_id: number;
  title: string;
  authors: string[];
  cover_url: string | null;
  position_secs: number;
  total_duration_secs: number;
  finished: boolean;
  updated_at: string;
}

export interface BookListeningProgressResponse {
  progress: BookListeningProgress[];
}

export interface BookListeningProgressRequest {
  position_secs: number;
  total_duration_secs: number;
  finished?: boolean;
  updated_at: string;
  device_id?: string;
}

interface BookListeningSeriesStat {
  name: string;
  books_total: number;
  books_finished: number;
  percent: number;
  current_title: string | null;
}

interface BookListeningWeekDay {
  day: string;
  seconds: number;
}

export interface BookListeningStats {
  timezone: string;
  today_secs: number;
  week_secs: number;
  streak_days: number;
  since: string | null;
  week: BookListeningWeekDay[];
  series: BookListeningSeriesStat[];
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
  /** Merged from the source chain. Book-level, unlike BookEdition.narrators. */
  narrators: string[];
  genres: string[];
  publisher: string | null;
  page_count: number | null;
  /** ISO-8601. published_year is kept; list sorting depends on it. */
  published_date: string | null;
  rating: number | null;
  rating_count: number | null;
  added_at: string;
  updated_at: string;
  overrides?: Record<string, unknown>;
  /** Field -> source that supplied it; absent means never enriched or set by an operator override. */
  metadata_sources: Record<string, BookMetadataSource>;
  editions: BookEdition[];
  /** When this user marked the whole book read. Null if they have not. */
  read_at: string | null;
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
  /** The request for this volume, if any. Status only — never who asked. */
  request: { id: number; status: MediaRequestStatus } | null;
}

export interface BookSearchResponse {
  results: BookSearchResult[];
}

export interface AddBookRequest {
  google_volume_id: string;
  /** Preferred ISBN-13 to store; Google's volume may list a sibling edition's id instead. */
  isbn13?: string | null;
  /** Which editions to create and monitor. Defaults to ["ebook"]. */
  kinds?: BookEditionKind[];
  book_quality_profile_id?: number | null;
  monitored?: boolean;
}

/** `kind` comes from parsed format and size, not indexer category; audiobooks turn up under Books. */
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

/** Identity is the provider's author name (no author id exists), so homonyms collide; empty `monitor_edition_kinds` means unmonitored. */
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
  /** ISO 639-1 codes a new title must be in; empty means any. */
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

/** Sources in default merge order; "local" outranks remote so a tagger repair isn't reverted on refresh. */
export type BookMetadataSource =
  | "local"
  | "audnexus"
  | "googlebooks"
  | "openlibrary";

export interface BookRefreshMetadataResponse {
  book_id: number;
  changed_fields: string[];
  /** Sources that were unavailable. Reported so an outage is legible. */
  failed_sources: BookMetadataSource[];
  used_sources: BookMetadataSource[];
}

export interface BookMetadataSourceOrderResponse {
  order: BookMetadataSource[];
}

interface AudnexusIntegration {
  type: "audnexus";
  enabled: boolean;
  /** Defaults to the public instance; a self-hosted one can be used instead. */
  base_url: string;
  region: string;
}

export interface AudnexusIntegrationResponse {
  integration: AudnexusIntegration;
}

export interface AudnexusIntegrationUpdateResponse {
  success: true;
  integration: AudnexusIntegration;
}

export interface AudnexusTestResponse {
  success: boolean;
  error?: string;
}

/** Manual overrides; null clears a field back to the source chain. `authors` is absent because a trigger maintains it. */
export interface BookOverridesRequest {
  title?: string | null;
  subtitle?: string | null;
  series_name?: string | null;
  series_position?: number | null;
  narrators?: string[] | null;
  genres?: string[] | null;
  publisher?: string | null;
  page_count?: number | null;
  published_date?: string | null;
  published_year?: number | null;
  rating?: number | null;
  rating_count?: number | null;
  language?: string | null;
  overview?: string | null;
  cover_url?: string | null;
  isbn13?: string | null;
}

/** Reader position: a spine document plus an offset, unrelated to audiobook seconds. */
export interface BookReadingProgress {
  edition_id: number;
  book_id: number;
  title: string;
  authors: string[];
  cover_url: string | null;
  /** Which file the position was recorded against; an edition can hold several. */
  file_id: number | null;
  spine_index: number;
  /** Spine document path in the archive; verify it before trusting `spine_index`, since a re-download can reorder the spine. */
  spine_path: string;
  spine_count: number;
  /** 0–1 scroll offset within the spine document. */
  scroll_fraction: number;
  /** Serialised Readium Locator JSON reported by the reader. */
  locator: string | null;
  finished: boolean;
  updated_at: string;
}

export interface BookReadingProgressResponse {
  progress: BookReadingProgress[];
}

export interface BookReadingProgressRequest {
  file_id?: number | null;
  spine_index: number;
  spine_path: string;
  spine_count: number;
  scroll_fraction: number;
  /** Serialised Readium Locator JSON reported by the reader. */
  locator?: string | null;
  finished?: boolean;
  updated_at: string;
  device_id?: string;
}

/** Explore: ranked bestseller lists from external sources, enriched by ISBN through the provider chain. */
export type BookDiscoverySourceId = "leslibraires" | "nyt";

export interface BookDiscoveryBook {
  rank: number;
  title: string;
  isbn13: string | null;
  coverUrl: string | null;
  sourceUrl: string | null;
  author: string | null;
  overview: string | null;
  publishedYear: number | null;
  /** Present once enriched — required to add the book to the library. */
  volumeId: string | null;
  alreadyInLibrary: boolean;
  /** The request for this volume, if any. Status only — never who asked. */
  request: { id: number; status: MediaRequestStatus } | null;
}

export interface BookDiscoveryList {
  id: string;
  label: string;
}

export interface BookDiscoveryResponse {
  source: BookDiscoverySourceId;
  list: string;
  items: BookDiscoveryBook[];
}

export interface BookDiscoverySourcesResponse {
  sources: {
    id: BookDiscoverySourceId;
    label: string;
    lists: BookDiscoveryList[];
  }[];
}

/** The subset of a Readium Locator the reader needs to open at a sentence. */
export interface BookReadiumLocator {
  /** OPF-relative spine href, the same format stored as a reading position's spine_path. */
  href: string;
  type: string;
  locations: {
    progression: number;
    totalProgression: number;
  };
  text?: {
    before?: string;
    highlight?: string;
    after?: string;
  };
}

export interface BookHandoffToEbookRequest {
  /** Whole-book audiobook seconds. */
  position_secs: number;
}

export interface BookHandoffToEbookResponse {
  locator: BookReadiumLocator;
  spine_index: number;
  spine_path: string;
  /** 0..1 within the spine document. */
  progression: number;
  /** 0..1 across the whole ebook text. */
  total_progression: number;
  /** 0..1 match confidence. */
  score: number;
  transcript: string;
}

export interface BookHandoffToAudiobookRequest {
  spine_path: string;
  /** 0..1 within the spine document. */
  progression: number;
}

export interface BookHandoffToAudiobookResponse {
  /** Whole-book audiobook seconds. */
  position_secs: number;
  /** 0..1 confidence of the last matched pass. */
  score: number;
  /** Transcription calls spent. */
  calls: number;
  transcript: string;
}
