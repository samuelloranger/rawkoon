export interface MediaItem {
  id: string;
  media_type: "movie" | "series";
  source_id: number | null;
  title: string;
  sort_title: string | null;
  year: number | null;
  status: string | null;
  monitored: boolean;
  downloaded: boolean;
  downloading: boolean;
  added_at: string | null;
  tmdb_id: number | null;
  imdb_id: string | null;
  tvdb_id: number | null;
  season_count: number | null;
  episode_count: number | null;
  poster_url: string | null;
  release_tags: string[] | null;
}

export interface TmdbMediaSearchItem {
  id: string;
  tmdb_id: number;
  media_type: "movie" | "tv";
  title: string;
  release_year: number | null;
  poster_url: string | null;
  overview: string | null;
  vote_average: number | null;
  already_exists: boolean;
  can_add: boolean;
  source_id: number | null;
  /** Native library ID — when set, Management tab shows LibraryManagementPanel */
  library_id?: number | null;
}

export interface TmdbMediaSearchResponse {
  enabled: boolean;
  items: TmdbMediaSearchItem[];
}

interface TmdbWatchProvider {
  id: number;
  name: string;
  logo_url: string;
}

export interface TmdbWatchProvidersResponse {
  region: string;
  streaming: TmdbWatchProvider[];
  free: TmdbWatchProvider[];
  rent: TmdbWatchProvider[];
  buy: TmdbWatchProvider[];
  link: string | null;
}

interface ScoreComponentDto {
  code: string;
  value: number;
  params?: Record<string, string | number>;
}

export interface ScoreBreakdownDto {
  rejected: boolean;
  total: number | null;
  components: ScoreComponentDto[];
  matched_formats: string[];
}

interface ParsedQualityFields {
  resolution: number | null;
  source: string | null;
  codec: string | null;
  hdr: string | null;
}

export type IndexerManagerType = "prowlarr" | "jackett";

export interface IndexerWarning {
  id: string;
  name: string;
  error: string;
}

export interface InteractiveReleaseItem {
  guid: string;
  title: string;
  indexer: string | null;
  indexer_id: number | null;
  languages: string[];
  protocol: string | null;
  size_bytes: number | null;
  age: number | null;
  seeders: number | null;
  leechers: number | null;
  rejected: boolean;
  rejection_reason: string | null;
  info_url: string | null;
  source: IndexerManagerType;
  download_token?: string | null;
  /** Resolved magnet or .torrent URL (Prowlarr); used for Rawkoon library grabs */
  download_url?: string | null;
  /** Set when Prowlarr search is scoped to a library item with a quality profile */
  quality_score?: number | null;
  parsed_quality?: ParsedQualityFields | null;
  /**
   * Stable rejection reason codes for quality-profile hard-requirement failures.
   * Values: "resolution_below_min", "resolution_above_cutoff",
   * "hdr_required_absent", "language_no_match", "size_over_cap", "is_sample",
   * "seeders_below_min", "custom_format_required_absent",
   * "custom_format_forbidden_present". The frontend maps each code to a
   * translated message. (Population of this field from the search response is a
   * Plan 2 task — see docs/superpowers/plans.)
   */
  quality_rejection_reasons?: string[] | null;
  /** Structured score breakdown per release, populated when search is scoped to a library item with a quality profile. */
  score_breakdown?: ScoreBreakdownDto | null;
  /** True when the release title matches a full-season pattern (SXX with no episode number) */
  is_season_pack?: boolean;
  /** True when the release is a complete series (intégrale, Complete Series, …) */
  is_complete_series?: boolean;
  /** True when the release is freeleech on the tracker (Jackett-only) */
  freeleech?: boolean;
}

/** A release the grabber must never auto-download again. */
export interface BlocklistEntry {
  id: number;
  torrent_hash: string | null;
  release_title: string;
  indexer: string | null;
  media_id: number | null;
  episode_id: number | null;
  reason: string | null;
  blocked_at: string;
}

export interface BlocklistListResponse {
  entries: BlocklistEntry[];
}

export interface AddBlocklistEntryPayload {
  release_title: string;
  torrent_hash?: string;
  indexer?: string;
  media_id?: number;
  episode_id?: number;
  reason?: string;
}

export interface MediaInteractiveSearchResponse {
  success: boolean;
  service: IndexerManagerType;
  releases: InteractiveReleaseItem[];
  indexer_warnings?: IndexerWarning[];
}

export interface SimilarMediasResponse {
  items: TmdbMediaSearchItem[];
}

export interface MediaInteractiveDownloadResponse {
  success: boolean;
  service: IndexerManagerType;
  download_url?: string | null;
  magnet_url?: string | null;
}

interface TmdbStreamingProvider {
  id: number;
  name: string;
  logo_url: string;
}

export interface TmdbStreamingProvidersResponse {
  providers: TmdbStreamingProvider[];
  region: string;
}

export interface TmdbTrailerResponse {
  key: string | null;
  name: string | null;
}

export interface TmdbGenre {
  id: number;
  name: string;
}

export interface TmdbGenresResponse {
  genres: TmdbGenre[];
}

export interface DiscoverMediasParams {
  type: "movie" | "tv";
  provider_id?: number | null;
  genre_id?: number | null;
  sort_by?: string;
  page?: number;
  language?: string;
  original_language?: string | null;
}

export interface DiscoverMediasResponse {
  items: TmdbMediaSearchItem[];
  page: number;
  region: string;
  total_pages: number;
  total_results: number;
}

export interface MediaRatingsResponse {
  imdb_rating: string | null;
  rotten_tomatoes: string | null;
  metacritic: string | null;
}

interface TmdbCastMember {
  id: number;
  name: string;
  character: string | null;
  profile_url: string | null;
}

export interface TmdbCreditsResponse {
  cast: TmdbCastMember[];
  directors: string[];
}

export interface TmdbCollection {
  id: number;
  name: string;
  poster_url: string | null;
}

export interface TmdbProductionCountry {
  iso_3166_1: string;
  name: string;
}

export interface TmdbProductionCompany {
  id: number;
  name: string;
  logo_url: string | null;
  origin_country: string | null;
}

export interface TmdbSpokenLanguage {
  english_name: string;
  iso_639_1: string;
  name: string;
}

export interface TmdbExternalIds {
  imdb_id: string | null;
  facebook_id: string | null;
  instagram_id: string | null;
  twitter_id: string | null;
  wikidata_id: string | null;
}

export interface TmdbImageStill {
  url: string;
  width: number | null;
  height: number | null;
  vote_average: number | null;
}

export interface TmdbMediaStills {
  backdrops: TmdbImageStill[];
  logos: TmdbImageStill[];
  posters: TmdbImageStill[];
}

export interface TmdbNextEpisode {
  name: string | null;
  air_date: string | null;
  episode_number: number | null;
  season_number: number | null;
  runtime: number | null;
}

export interface TmdbNetwork {
  id: number;
  name: string;
  logo_url: string | null;
}

export interface TmdbCreator {
  id: number;
  name: string;
  profile_url: string | null;
}

/** TV show only: season rows from TMDB details `seasons` (incl. specials as season 0). */
export interface TmdbSeasonSummary {
  season_number: number;
  /** Display name from TMDB (e.g. "Season 1", "Specials"). */
  name: string;
  episode_count: number | null;
}

export interface TitleTranslation {
  /** ISO 639-1 language code (e.g. "en", "fr", "ja") */
  language_code: string;
  title: string;
}

export interface TmdbMediaDetailsResponse {
  runtime: number | null;
  belongs_to_collection: TmdbCollection | null;
  overview: string | null;
  vote_average: number | null;
  number_of_seasons: number | null;
  number_of_episodes: number | null;
  /** YYYY-MM-DD from TMDB (movies only) */
  release_date: string | null;
  tagline: string | null;
  genres: TmdbGenre[];
  /** TV: YYYY-MM-DD */
  first_air_date: string | null;
  last_air_date: string | null;
  /** Movie or TV status string from TMDB */
  status: string | null;

  original_title: string | null;
  /** One title per language from TMDB translations; powers the search title picker */
  title_translations: TitleTranslation[];
  /** ISO 639-1 code */
  original_language: string | null;
  /** Best-effort display name for original language */
  original_language_label: string | null;
  production_countries: TmdbProductionCountry[];
  production_companies: TmdbProductionCompany[];
  spoken_languages: TmdbSpokenLanguage[];

  /** Movies: USD from TMDB */
  budget: number | null;
  revenue: number | null;

  homepage: string | null;
  external_ids: TmdbExternalIds | null;

  /** Primary backdrop (from main `backdrop_path`) */
  primary_backdrop_url: string | null;
  media_stills: TmdbMediaStills;

  /** TV: Scripted, Documentary, etc. */
  tv_type: string | null;
  networks: TmdbNetwork[];
  created_by: TmdbCreator[];
  episode_run_times: number[];
  next_episode_to_air: TmdbNextEpisode | null;
  last_episode_to_air: TmdbNextEpisode | null;

  /** TV: ordered by `season_number` (movies: empty). */
  seasons: TmdbSeasonSummary[];
}

export interface WatchlistItem {
  id: number;
  tmdb_id: number;
  media_type: "movie" | "tv";
  title: string;
  poster_url: string | null;
  overview: string | null;
  release_year: number | null;
  vote_average: number | null;
  added_at: string;
  /** Cached TMDB release date for movies (YYYY-MM-DD); used for day-before reminders */
  movie_release_date: string | null;
}

export interface WatchlistResponse {
  items: WatchlistItem[];
}

/** Episode row for TV modal when the series is in the native library. */
interface MediaLibraryEpisodeRef {
  season_number: number;
  episode_number: number;
}

export interface MediaModalLibraryEpisodes {
  /** True when this TMDB show exists in the native library. */
  in_library: boolean;
  /** Episodes marked downloaded in the library; empty when none. */
  downloaded: MediaLibraryEpisodeRef[];
}

export interface MediaModalDataResponse {
  watchlist_status: boolean;
  watchlist_id: number | null;
  trailer: TmdbTrailerResponse;
  ratings: MediaRatingsResponse;
  credits: TmdbCreditsResponse;
  details: TmdbMediaDetailsResponse;
  providers: TmdbWatchProvidersResponse;
  /** TV: native library episode state; null for movies. */
  library_episodes: MediaModalLibraryEpisodes | null;
}

export interface CollectionMovieItem {
  id: string;
  tmdb_id: number;
  media_type: "movie";
  title: string;
  release_year: number | null;
  release_date: string | null;
  poster_url: string | null;
  overview: string | null;
  vote_average: number | null;
  already_exists: boolean;
  can_add: boolean;
  source_id: number | null;
}

export interface MediaCollection {
  id: number;
  name: string;
  overview: string | null;
  poster_url: string | null;
  backdrop_url: string | null;
  movies: CollectionMovieItem[];
  owned_count: number;
  total_count: number;
  missing_count: number;
}

export interface MissingCollectionsResponse {
  collections: MediaCollection[];
}
