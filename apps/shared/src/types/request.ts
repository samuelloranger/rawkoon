import type { SearchSkippedReason } from "./library";

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
