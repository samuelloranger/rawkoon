export const CLIPS_ENDPOINTS = {
  SETTINGS: "/api/clips/settings",
  PROGRESS: "/api/clips/progress",
  RETRY: "/api/clips/retry",
  DELETE_ALL: "/api/clips/delete-all",
  MEDIA: (mediaId: number) => `/api/clips/media/${mediaId}`,
  RECUT: (id: number) => `/api/clips/${id}/recut`,
  // `v` busts the browser cache after a re-cut; the server ignores it.
  FILE: (
    tmdbId: number,
    type: "movie" | "show",
    season: number | undefined,
    v: string,
  ) =>
    `/api/clips/file?tmdbId=${tmdbId}&type=${type}${season ? `&season=${season}` : ""}&v=${encodeURIComponent(v)}`,
};
