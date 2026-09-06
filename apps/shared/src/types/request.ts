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

export interface ApproveMediaRequestBody {
  /**
   * Movie/show requests: the QualityProfile id. Book requests: the
   * BookQualityProfile id (a separate table — same field, request-type-scoped
   * meaning, so the request/approve contract stays a single field).
   */
  quality_profile_id: number;
}

export interface DenyMediaRequestBody {
  deny_reason?: string;
}
