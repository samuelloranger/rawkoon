import type { ShelfDetail, ShelfOrderMode } from "@rawkoon/shared/types";

export type Draft = {
  name: string;
  description: string;
  orderMode: ShelfOrderMode;
  homeRow: boolean;
  visibleFrom: string | null;
  visibleTo: string | null;
  coverStyle: "mosaic" | "backdrop" | "upload";
  coverTmdbId: number | null;
  coverType: "movie" | "show" | null;
  coverUrl: string | null;
};

export const draftOf = (shelf: ShelfDetail): Draft => ({
  name: shelf.name,
  description: shelf.description ?? "",
  orderMode: shelf.order_mode,
  homeRow: shelf.home_row,
  visibleFrom: shelf.visible_from,
  visibleTo: shelf.visible_to,
  coverStyle: shelf.cover.style,
  coverTmdbId: shelf.cover_tmdb_id,
  coverType: shelf.cover_type,
  coverUrl: shelf.cover.style === "backdrop" ? shelf.cover.backdrop_url : null,
});
