import type { LibraryAttentionKind } from "@rawkoon/shared/types";

export type LibraryAttentionScopeType = "movie" | "episode" | "season_pack";

export type AttentionCandidate = {
  media_id: number;
  media_title: string;
  media_type: "movie" | "show";
  scope_type: LibraryAttentionScopeType;
  episode_id: number | null;
  season: number | null;
  episode_number: number | null;
  kind: LibraryAttentionKind;
  detail: string | null;
  search_attempts: number | null;
  library_status: string | null;
  download_history_id: number | null;
  grabbed_at: Date | null;
};

const KIND_PRIORITY: Record<LibraryAttentionKind, number> = {
  download_failed: 1,
  post_process_error: 2,
  download_stuck: 3,
  grab_skipped: 4,
  auto_grab_stalled: 5,
};

export function attentionKindPriority(kind: LibraryAttentionKind): number {
  return KIND_PRIORITY[kind];
}
