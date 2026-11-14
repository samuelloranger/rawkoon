// Shelves: named, ordered lists of movies and shows, browsed on the TV inside
// Collections and optionally as a Home row. Admins edit them in web and iOS.

export type ShelfOrderMode = "manual" | "release" | "rating" | "added";
export type ShelfCoverStyle = "mosaic" | "backdrop" | "upload";
export type ShelfMediaType = "movie" | "show";

export type ShelfCover =
  | {
      style: "mosaic";
      /** Up to 4 poster URLs, in display order. */
      posters: string[];
    }
  | { style: "backdrop"; backdrop_url: string | null }
  /** An image an administrator uploaded; the URL is absolute for the client that asked. */
  | { style: "upload"; url: string | null };

export interface ShelfSummary {
  id: number;
  name: string;
  description: string | null;
  cover: ShelfCover;
  entry_count: number;
  in_library_count: number;
  home_row: boolean;
  visible_from: string | null;
  visible_to: string | null;
  visible_now: boolean;
  order_mode: ShelfOrderMode;
  /** The title whose backdrop is the cover, when the style is "backdrop". */
  cover_tmdb_id: number | null;
  cover_type: ShelfMediaType | null;
  seed_key: string | null;
  /** Admins only: the rules and whether matching titles join by themselves; null/false for everyone else. */
  rules: ShelfRules | null;
  auto_join: boolean;
}

export interface ShelfEntryView {
  id: number;
  tmdb_id: number;
  type: ShelfMediaType;
  season: number | null;
  title: string;
  year: number | null;
  poster_url: string | null;
  backdrop_url: string | null;
  group_label: string | null;
  position: number;
  in_library: boolean;
  library_id: number | null;
  source: "manual" | "rule";
  /** Why a rule-sourced entry matches, for admins (possibly empty once the rules changed); null otherwise. */
  reason: string[] | null;
  /** Removed by an admin after rules added it; only sent to the editor (`?excluded=1`), so rules never re-add it. */
  excluded: boolean;
}

export interface ShelfDetail extends ShelfSummary {
  entries: ShelfEntryView[];
  /** Admins only: TMDB names for the ids the rules mention, keyed `keyword:<id>`, `company:<id>`, `network:<id>`, `collection:<id>`, `genre:<id>`. */
  rule_names?: Record<string, string>;
}

/** One seed card in the "New shelf" dialog. */
export interface ShelfSeedSummary {
  key: string;
  name: string;
  description: string;
  order_mode: ShelfOrderMode;
  home_row: boolean;
  visible_from: string | null;
  visible_to: string | null;
}

/** One row in the "Add to shelf" menu. */
export interface ShelfMembership {
  id: number;
  name: string;
  holds: boolean;
  /** The whole-title entry's id when `holds`; null otherwise. */
  entry_id: number | null;
  /** Only manual shelves take titles by hand; the clients list those. */
  order_mode: ShelfOrderMode;
}

/** What a shelf's rules select from the library's title facts. Unset fields don't constrain. */
export interface ShelfRules {
  types?: ("movie" | "show")[];
  genres_any?: number[];
  genres_none?: number[];
  keywords_any?: number[];
  keywords_none?: number[];
  companies_any?: number[];
  networks_any?: number[];
  tmdb_collection?: number;
  year_min?: number;
  year_max?: number;
  votes_min?: number;
  rating_min?: number;
  certifications?: string[]; // e.g. ["G", "PG"]
}

/** One title in a rules preview. */
export interface ShelfPreviewTitle {
  tmdb_id: number;
  type: ShelfMediaType;
  title: string;
  year: number | null;
  poster_url: string | null;
  /** Already on the shelf (and not excluded). */
  in_shelf: boolean;
  /** Matches: the rule parts that selected it. Excluded: the `*_none` parts that removed it. */
  reason: string[];
}

export interface ShelfPreview {
  matches: ShelfPreviewTitle[];
  /** Titles a `*_none` rule removed, so an admin can pin them in by hand. */
  excluded: ShelfPreviewTitle[];
  /** True when either list was cut at the server's cap. */
  truncated: boolean;
}

/** A TMDB keyword or company, for the rules editor's search. */
export interface ShelfLookupItem {
  id: number;
  name: string;
}
