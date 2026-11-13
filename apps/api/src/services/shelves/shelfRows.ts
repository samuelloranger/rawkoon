/** The columns a shelf and its entries are read with, shared by the shelf and entry services. */
export const shelfRowSelect = {
  id: true,
  name: true,
  description: true,
  orderMode: true,
  coverStyle: true,
  coverTmdbId: true,
  coverType: true,
  coverFile: true,
  homeRow: true,
  visibleFrom: true,
  visibleTo: true,
  seedKey: true,
  position: true,
} as const;

export const entryRowSelect = {
  id: true,
  shelfId: true,
  tmdbId: true,
  type: true,
  season: true,
  position: true,
  groupLabel: true,
  source: true,
  excluded: true,
  title: true,
  year: true,
  posterPath: true,
  addedAt: true,
} as const;

/** The key an entry's library row is found by: its kind and TMDB id. */
export const key = (type: string, tmdbId: number) => `${type}:${tmdbId}`;
