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
  /** Rule parts that matched; set from the rules phase onward. */
  reason: string[] | null;
}

export interface ShelfDetail extends ShelfSummary {
  entries: ShelfEntryView[];
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
