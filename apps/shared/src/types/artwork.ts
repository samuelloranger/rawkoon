export type ArtworkKind = "poster" | "backdrop";
export type ArtworkSource = "tmdb" | "fanart";

export interface ArtworkCandidate {
  /** Full-resolution image URL, used when the candidate is selected. */
  url: string;
  /** Small URL for the grid. Equals `url` when the source offers no thumbnail. */
  thumb_url: string;
  width: number | null;
  height: number | null;
  /** ISO 639-1, or null for a language-neutral (textless) image. */
  language: string | null;
  /** Source-relative popularity; higher is better. Null when unknown. */
  vote: number | null;
  source: ArtworkSource;
}

export interface ArtworkCandidatesResponse {
  candidates: ArtworkCandidate[];
}
