/**
 * "book" and "audiobook" both query categories 7000 AND 3000, because the
 * split is not reliable at the tracker: a real 262 MB audiobook release was
 * returned under 7000 (Books). The edition kind is therefore derived from the
 * parsed release format and size, never from the category — see
 * utils/books/bookReleaseParser.inferEditionKind.
 *
 * Only 3000 and 7000 are used, not 3030/7020: a live Jackett aggregate
 * advertises just the top-level categories, so the narrower ids match nothing.
 */
export type IndexerMediaType = "movie" | "tv" | "book" | "audiobook";

export interface IndexerSearchParams {
  query?: string;
  type: "freetext" | "tvsearch";
  mediaType?: IndexerMediaType;
  tmdbId?: number | null;
  season?: number | null;
  limit?: number;
}

export interface NormalizedRelease {
  guid: string;
  title: string;
  indexer: string | null;
  indexerId: number | null;
  languages: string[];
  protocol: string | null;
  sizeBytes: number | null;
  age: number | null;
  seeders: number | null;
  leechers: number | null;
  rejected: boolean;
  rejections: string[];
  infoUrl: string | null;
  downloadUrl: string | null;
  magnetUrl: string | null;
  infoHash: string | null;
  /** TMDb ID reported by the indexer (partial — not all trackers provide it) */
  tmdbId: number | null;
  /** Download volume factor: 0 = freeleech, 1 = normal (Jackett-only) */
  freeleech: boolean;
  /** Original raw payload — Prowlarr stores this on the download token */
  rawPayload?: Record<string, unknown>;
}

export interface NormalizedIndexer {
  id: number;
  /** String identifier used in adapter-specific URLs/params (Jackett slug or Prowlarr numeric ID as string). */
  slug: string;
  name: string;
  protocol: string;
  enabled: boolean;
  privacy: string;
}

export interface GrabResult {
  success: boolean;
  downloadUrl?: string;
  magnetUrl?: string;
  /** Release title from the stored token — needed to call grabRelease(). */
  title?: string;
  indexer?: string | null;
  error?: string;
}

export interface IndexerWarning {
  /** Jackett indexer ID slug (e.g. "my-indexer") */
  id: string;
  /** Human-readable indexer name (e.g. "My Indexer") */
  name: string;
  /** Error message from Jackett */
  error: string;
}

export interface SearchResult {
  releases: NormalizedRelease[];
  indexerWarnings: IndexerWarning[];
}

export interface IndexerManagerAdapter {
  readonly name: "prowlarr" | "jackett";

  search(params: IndexerSearchParams): Promise<SearchResult>;

  getIndexers(): Promise<NormalizedIndexer[]>;

  /**
   * Resolve a stored token to a download URL/magnet (and title).
   * Neither adapter hands the torrent to a download client — Rawkoon owns that.
   */
  grabRelease(token: string): Promise<GrabResult>;

  /**
   * Store a release and return a download token for later grab.
   * Prowlarr stores the raw payload (URL extracted at grab time); Jackett stores
   * the download URL/magnet plus title. Returns null if there is no target.
   */
  storeReleaseToken(release: NormalizedRelease): string | null;

  /**
   * Fetch recent releases from specific indexers without a search query (RSS-style).
   * @param indexerIds - Jackett: string slugs (e.g. "my-indexer"); Prowlarr: numeric IDs as strings (e.g. "1")
   * @param categories - Torznab category ids; defaults to movies + TV. Books
   *   pass 7000 + 3000, because an audiobook is filed under either depending on
   *   the tracker.
   */
  fetchRss(
    indexerIds: string[],
    categories?: string[],
  ): Promise<NormalizedRelease[]>;
}
