export type MediaRequestStatus =
  | "pending"
  | "approved"
  | "denied"
  | "available";

export interface MediaRequest {
  id: number;
  tmdb_id: number;
  type: "movie" | "show";
  title: string;
  poster_url: string | null;
  year: number | null;
  status: MediaRequestStatus;
  requested_by: { id: string; name: string | null };
  quality_profile_id: number | null;
  library_media_id: number | null;
  deny_reason: string | null;
  created_at: string;
  decided_at: string | null;
}

export interface MediaRequestsResponse {
  requests: MediaRequest[];
}

export interface CreateMediaRequestBody {
  tmdb_id: number;
  type: "movie" | "show";
  title: string;
  poster_url?: string | null;
  year?: number | null;
}

export interface ApproveMediaRequestBody {
  quality_profile_id: number;
}

export interface DenyMediaRequestBody {
  deny_reason?: string;
}
