export const MEDIAS_ENDPOINTS = {
  EXPLORE: "/api/medias/explore",
  SIMILAR: (tmdbId: number, type: "movie" | "tv") =>
    `/api/medias/similar/${encodeURIComponent(String(tmdbId))}?type=${encodeURIComponent(type)}`,
  TMDB_SEARCH: (q: string, language?: string, kind?: "movie" | "tv") => {
    const p = new URLSearchParams({ q });
    if (language) p.set("language", language);
    if (kind) p.set("kind", kind);
    return `/api/medias/tmdb-search?${p.toString()}`;
  },
  INTERACTIVE_SEARCH: "/api/medias/interactive-search",
  INTERACTIVE_SEARCH_DOWNLOAD: "/api/medias/interactive-search/download",
  INTERACTIVE_SEARCH_AI_PICK: "/api/medias/search/ai-pick",
  INTERACTIVE_SEARCH_AI_WARM: "/api/medias/search/ai-warm",
  INDEXERS: "/api/medias/indexers",
  BLOCKLIST: "/api/medias/blocklist",
  BLOCKLIST_ENTRY: (id: number) => `/api/medias/blocklist/${id}`,
  STREAMING_PROVIDERS: (type?: "movie" | "tv", language?: string) => {
    const p = new URLSearchParams({
      type: type ?? "movie",
    });
    if (language) p.set("language", language);
    return `/api/medias/streaming-providers?${p.toString()}`;
  },
  GENRES: (type: "movie" | "tv", language?: string) => {
    const p = new URLSearchParams({ type });
    if (language) p.set("language", language);
    return `/api/medias/genres?${p.toString()}`;
  },
  WATCHLIST: "/api/medias/watchlist",
  DISCOVER_DECK: (exclude: number[], limit = 20) => {
    const p = new URLSearchParams({ limit: String(limit) });
    if (exclude.length) p.set("exclude", exclude.join(","));
    return `/api/medias/discover/deck?${p.toString()}`;
  },
  DISCOVER_DISMISS: "/api/medias/discover/dismiss",
  DISCOVER_DISMISS_REMOVE: (tmdbId: number, type: "movie" | "tv") =>
    `/api/medias/discover/dismiss/${encodeURIComponent(String(tmdbId))}?type=${encodeURIComponent(type)}`,
  WATCHLIST_REMOVE: (tmdbId: number, type: "movie" | "tv") =>
    `/api/medias/watchlist/${encodeURIComponent(String(tmdbId))}?type=${encodeURIComponent(type)}`,
  MISSING_COLLECTIONS: (language?: string) =>
    language
      ? `/api/medias/collections/missing?language=${encodeURIComponent(language)}`
      : "/api/medias/collections/missing",
  MODAL_DATA: (
    mediaType: "movie" | "tv",
    tmdbId: number,
    language?: string,
  ) => {
    const p = new URLSearchParams();
    if (language) p.set("language", language);
    const qs = p.toString();
    return `/api/medias/modal/${encodeURIComponent(mediaType)}/${encodeURIComponent(String(tmdbId))}${qs ? `?${qs}` : ""}`;
  },
  DISCOVER: (params: {
    type: "movie" | "tv";
    provider_id?: number | null;
    genre_id?: number | null;
    sort_by?: string;
    page?: number;
    language?: string;
    original_language?: string | null;
  }) => {
    const p = new URLSearchParams();
    p.set("type", params.type);
    if (params.provider_id) p.set("provider_id", String(params.provider_id));
    if (params.genre_id) p.set("genre_id", String(params.genre_id));
    if (params.sort_by) p.set("sort_by", params.sort_by);
    if (params.page) p.set("page", String(params.page));
    if (params.language) p.set("language", params.language);
    if (params.original_language)
      p.set("original_language", params.original_language);
    return `/api/medias/discover?${p.toString()}`;
  },
} as const;
