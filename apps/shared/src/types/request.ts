import type { AiringState, SearchSkippedReason, SeasonMode } from "./library";

export type MediaRequestStatus =
  | "pending"
  | "approved"
  | "denied"
  | "available";

export interface MediaRequest {
  id: number;
  /** Null for a "book" request — books key off google_volume_id instead. */
  tmdb_id: number | null;
  type: "movie" | "show" | "book";
  title: string;
  /** Book requests only: display author line. */
  author: string | null;
  poster_url: string | null;
  year: number | null;
  /** Show requests only: what the requester chose; null = every season. */
  season_mode: SeasonMode | null;
  /** The seasons asked for when season_mode is "pick". */
  seasons: number[];
  status: MediaRequestStatus;
  requested_by: { id: string; name: string | null };
  quality_profile_id: number | null;
  library_media_id: number | null;
  /** Book requests only: the volume being requested. */
  google_volume_id: string | null;
  /** Book requests only: profile chosen at approval. */
  book_quality_profile_id: number | null;
  /** Book requests only: set once the request is approved and the book exists. */
  library_book_id: number | null;
  deny_reason: string | null;
  created_at: string;
  decided_at: string | null;
}

/** GET /api/requests/status: where one title stands, for a title page. */
export interface RequestTitleStatusResponse {
  library: {
    id: number;
    status: string;
    airing_state: AiringState | null;
    episode_count: number | null;
    downloaded_episode_count: number | null;
  } | null;
  request: {
    id: number;
    status: MediaRequestStatus;
    /** Only for the caller's own request, or to an admin. */
    deny_reason: string | null;
    /** True when the caller made the request. */
    mine: boolean;
  } | null;
}

export interface MediaRequestsResponse {
  requests: MediaRequest[];
}

export type CreateMediaRequestBody =
  | {
      type: "movie" | "show";
      tmdb_id: number;
      title: string;
      poster_url?: string | null;
      year?: number | null;
      /** Shows only; absent = every season. */
      season_mode?: SeasonMode;
      /** Required and non-empty with season_mode "pick", rejected otherwise. */
      seasons?: number[];
    }
  | {
      type: "book";
      google_volume_id: string;
      title: string;
      author?: string | null;
      poster_url?: string | null;
      year?: number | null;
    };

/** Approving a movie or show request; the search fields are absent for a book request. */
export interface ApproveRequestResponse {
  ok: true;
  library_media_id?: number;
  search_queued?: boolean;
  search_skipped_reason?: SearchSkippedReason | null;
}
