/** Why Rawkoon stopped owning a torrent (download_history.seed_release_reason). */
export type SeedReleaseReason =
  | "target_met"
  | "stalled"
  | "malware"
  | "import_rejected"
  | "manual"
  | "move_mode"
  | "adopted";

/** Why the janitor blocklisted a release; null on the entry = added by a user. */
export type BlocklistKind = "stalled" | "malware" | "import_rejected";

export interface SeedRule {
  ratio: number | null;
  seed_time_mins: number | null;
}

type SeedRuleSource = "override" | "private_default" | "public_default";

export type SeedingBadge = "removed_from_library" | "replaced_by_upgrade";

export interface SeedingTorrent {
  hash: string;
  name: string;
  title: string;
  year: number | null;
  kind_label: "movie" | "show" | "ebook" | "audiobook" | null;
  media_id: number | null;
  book_id: number | null;
  poster_url: string | null;
  indexer: string | null;
  is_private: boolean;
  badges: SeedingBadge[];
  rule: SeedRule;
  rule_source: SeedRuleSource;
  ratio: number | null;
  seeding_time_secs: number | null;
  up_speed: number;
  size_bytes: number;
  /** 0..1 progress toward each target; null when that target is not set. */
  ratio_pct: number | null;
  time_pct: number | null;
  lead: "ratio" | "time" | null;
  /** Seconds until release; null when it cannot be reached (idle, ratio-only). */
  eta_secs: number | null;
  target_met: boolean;
  owes_seed_time: boolean;
}

export interface ReleasedTorrent {
  hash: string;
  title: string;
  reason: SeedReleaseReason;
  released_at: string;
  size_bytes: number | null;
}

export interface SeedingResponse {
  enabled: boolean;
  torrents: SeedingTorrent[];
  released_today: ReleasedTorrent[];
  /** Present with ?preview=1: what one sweep would release now. */
  would_release_now?: { count: number; bytes: number };
}

interface OrphanTorrent {
  hash: string;
  name: string;
  category: string | null;
  size_bytes: number;
  ratio: number | null;
  seeding_time_secs: number | null;
  content_path: string | null;
  shares_data: boolean;
}

export interface OrphansResponse {
  orphans: OrphanTorrent[];
  total_bytes: number;
}

export interface RemoveOrphansRequest {
  hashes: string[];
  delete_data: boolean;
}

export interface RemoveOrphansResponse {
  removed: string[];
  refused: string[];
  freed_bytes: number;
}

export interface IndexerSeedRuleRow {
  indexer: string;
  is_private: boolean;
  override: SeedRule | null;
  effective: SeedRule;
  source: SeedRuleSource;
  held_count: number;
}

export interface SeedRulesResponse {
  indexers: IndexerSeedRuleRow[];
}

export interface UpsertSeedRuleRequest {
  ratio: number | null;
  seed_time_mins: number | null;
}

export interface JanitorStats {
  days: number;
  stalled: number;
  malware: number;
  import_rejected: number;
}

/** Seed state of one download_history row, shown as a chip in the history. */
export interface DownloadSeedState {
  state: "seeding" | "released" | "blocklisted";
  reason: SeedReleaseReason | null;
  ratio: number | null;
  seeding_time_secs: number | null;
}

/** One torrent in a `seed-state` SSE event. camelCase like every SSE payload. */
export interface SeedStateItem {
  hash: string;
  ratio: number | null;
  seedingTimeSecs: number | null;
  upSpeed: number;
  etaSecs: number | null;
  released?: {
    reason: SeedReleaseReason;
    at: string;
    freedBytes: number | null;
  };
}

export interface SeedStateEvent {
  kind: "seed-state";
  ts: number;
  torrents: SeedStateItem[];
}
