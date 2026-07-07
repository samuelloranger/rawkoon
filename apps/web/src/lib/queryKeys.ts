export const queryKeys = {
  auth: {
    all: ["auth"] as const,
    me: ["auth", "me"] as const,
    user: ["auth", "user"] as const,
    passkeyCredentials: ["auth", "passkey-credentials"] as const,
    validateInvitation: (token: string) =>
      [...queryKeys.auth.all, "validate-invitation", token] as const,
    ssoProviders: () => [...queryKeys.auth.all, "sso-providers"] as const,
    oidcProviders: () => [...queryKeys.auth.all, "oidc-providers"] as const,
  },

  settings: {
    all: ["settings"] as const,
    app: () => [...queryKeys.settings.all, "app"] as const,
  },

  downloads: {
    all: ["downloads"] as const,
    speed: () => [...queryKeys.downloads.all, "speed"] as const,
  },

  dashboard: {
    all: ["dashboard"] as const,
    activities: (limit?: number) =>
      [...queryKeys.dashboard.all, "activities", limit] as const,
    activityFeed: (params?: {
      limit?: number;
      service?: string;
      type?: string;
    }) =>
      [
        ...queryKeys.dashboard.all,
        "activity-feed",
        params?.limit,
        params?.service,
        params?.type,
      ] as const,
    jellyfinNowPlaying: () =>
      [...queryKeys.dashboard.all, "jellyfin-now-playing"] as const,
    upcoming: () => [...queryKeys.dashboard.all, "upcoming"] as const,
  },

  users: {
    all: ["users"] as const,
    list: () => [...queryKeys.users.all, "list"] as const,
  },

  notifications: {
    all: ["notifications"] as const,
    devices: () => [...queryKeys.notifications.all, "devices"] as const,
    list: (page?: number, limit?: number, read?: boolean) =>
      [...queryKeys.notifications.all, "list", page, limit, read] as const,
    infinite: (limit?: number, read?: boolean) =>
      [...queryKeys.notifications.all, "infinite", limit, read] as const,
    unreadCount: () =>
      [...queryKeys.notifications.all, "unread-count"] as const,
    channels: () => [...queryKeys.notifications.all, "channels"] as const,
    vapidPublicKey: () =>
      [...queryKeys.notifications.all, "vapid-public-key"] as const,
  },

  releases: {
    all: ["releases"] as const,
    list: () => [...queryKeys.releases.all, "list"] as const,
  },

  requests: {
    all: ["requests"] as const,
    list: () => [...queryKeys.requests.all, "list"] as const,
  },

  integrations: {
    all: ["integrations"] as const,
    jellyfin: () => [...queryKeys.integrations.all, "jellyfin"] as const,
    radarr: () => [...queryKeys.integrations.all, "radarr"] as const,
    sonarr: () => [...queryKeys.integrations.all, "sonarr"] as const,
    prowlarr: () => [...queryKeys.integrations.all, "prowlarr"] as const,
    prowlarrIndexers: () =>
      [...queryKeys.integrations.all, "prowlarr", "indexers"] as const,
    jackett: () => [...queryKeys.integrations.all, "jackett"] as const,
    jackettIndexers: () =>
      [...queryKeys.integrations.all, "jackett", "indexers"] as const,
    qbittorrent: () => [...queryKeys.integrations.all, "qbittorrent"] as const,
    tmdb: () => [...queryKeys.integrations.all, "tmdb"] as const,
    localAi: () => [...queryKeys.integrations.all, "local-ai"] as const,
  },

  admin: {
    all: ["admin"] as const,
    users: () => [...queryKeys.admin.all, "users"] as const,
    invitations: () => [...queryKeys.admin.all, "invitations"] as const,
    export: () => [...queryKeys.admin.all, "export"] as const,
    sessions: () => [...queryKeys.admin.all, "sessions"] as const,
    webPush: () => [...queryKeys.admin.all, "web-push"] as const,
    apiKeys: () => [...queryKeys.admin.all, "api-keys"] as const,
    scheduledJobs: () => [...queryKeys.admin.all, "scheduled-jobs"] as const,
    libraryHealth: () => [...queryKeys.admin.all, "library-health"] as const,
    testEmailTemplates: () =>
      [...queryKeys.admin.all, "test-email-templates"] as const,
    queueJobs: (queue: string, status?: string) =>
      [...queryKeys.admin.all, "queue-jobs", queue, status] as const,
    jobHistory: () => [...queryKeys.admin.all, "job-history"] as const,
  },

  medias: {
    all: ["medias"] as const,
    explore: () => [...queryKeys.medias.all, "explore"] as const,
    similar: (tmdbId: number, type: "movie" | "tv") =>
      [...queryKeys.medias.all, "similar", tmdbId, type] as const,
    tmdbSearch: (
      query: string,
      language?: string,
      kind?: "movie" | "tv" | "any",
    ) =>
      [
        ...queryKeys.medias.all,
        "tmdb-search",
        query,
        language ?? "en-US",
        kind ?? "any",
      ] as const,
    interactiveSearch: (
      query: string,
      libraryMediaId?: number | null,
      season?: number | "complete" | null,
    ) =>
      [
        ...queryKeys.medias.all,
        "interactive-search",
        query,
        libraryMediaId ?? null,
        season ?? null,
      ] as const,
    aiPick: (
      title: string,
      year: number | null,
      mediaType: "movie" | "tv",
      releaseKeys: string,
    ) =>
      [
        ...queryKeys.medias.all,
        "ai-pick",
        title,
        year,
        mediaType,
        releaseKeys,
      ] as const,
    providers: (mediaType: "movie" | "tv", tmdbId: number, language?: string) =>
      [
        ...queryKeys.medias.all,
        "providers",
        mediaType,
        tmdbId,
        language ?? "en-US",
      ] as const,
    streamingProviders: (type?: "movie" | "tv", language?: string) =>
      [
        ...queryKeys.medias.all,
        "streaming-providers",
        type ?? "movie",
        language ?? "en-US",
      ] as const,
    trailer: (mediaType: "movie" | "tv", tmdbId: number, language?: string) =>
      [
        ...queryKeys.medias.all,
        "trailer",
        mediaType,
        tmdbId,
        language ?? "en-US",
      ] as const,
    genres: (type: "movie" | "tv", language?: string) =>
      [...queryKeys.medias.all, "genres", type, language ?? "en-US"] as const,
    ratings: (mediaType: "movie" | "tv", tmdbId: number, language?: string) =>
      [
        ...queryKeys.medias.all,
        "ratings",
        mediaType,
        tmdbId,
        language ?? "en-US",
      ] as const,
    credits: (mediaType: "movie" | "tv", tmdbId: number, language?: string) =>
      [
        ...queryKeys.medias.all,
        "credits",
        mediaType,
        tmdbId,
        language ?? "en-US",
      ] as const,
    tmdbDetails: (
      mediaType: "movie" | "tv",
      tmdbId: number,
      language?: string,
    ) =>
      [
        ...queryKeys.medias.all,
        "tmdb-details",
        mediaType,
        tmdbId,
        language ?? "en-US",
      ] as const,
    watchlist: () => [...queryKeys.medias.all, "watchlist"] as const,
    discoverDeck: () => [...queryKeys.medias.all, "discover-deck"] as const,
    missingCollections: (language?: string) =>
      [
        ...queryKeys.medias.all,
        "missing-collections",
        language ?? "en-US",
      ] as const,
    modalData: (mediaType: "movie" | "tv", tmdbId: number, language?: string) =>
      [
        ...queryKeys.medias.all,
        "modal",
        "v2",
        mediaType,
        tmdbId,
        language ?? "en-US",
      ] as const,
    modalDataAll: (mediaType: "movie" | "tv", tmdbId: number) =>
      [...queryKeys.medias.all, "modal", "v2", mediaType, tmdbId] as const,
    discover: (params: {
      type: "movie" | "tv";
      provider_id?: number | null;
      genre_id?: number | null;
      sort_by?: string;
      page?: number;
      language?: string;
      original_language?: string | null;
    }) =>
      [
        ...queryKeys.medias.all,
        "discover",
        params.type,
        params.provider_id ?? null,
        params.genre_id ?? null,
        params.sort_by ?? "popularity.desc",
        params.page ?? 1,
        params.language ?? "en-US",
        params.original_language ?? null,
      ] as const,
  },

  search: {
    all: ["search"] as const,
    quick: (query: string) =>
      [...queryKeys.search.all, "quick", query] as const,
  },

  library: {
    all: ["library"] as const,
    list: (filters?: {
      type?: string;
      status?: string;
      q?: string;
      language?: string;
    }) => [...queryKeys.library.all, "list", filters] as const,
    item: (id: number) => [...queryKeys.library.all, "item", id] as const,
    recentlyAdded: (limit: number) =>
      [...queryKeys.library.all, "recently-added", limit] as const,
    files: (id: number | null) =>
      [...queryKeys.library.all, "files", id] as const,
    episodes: (id: number) =>
      [...queryKeys.library.all, "episodes", id] as const,
    downloads: (id: number) =>
      [...queryKeys.library.all, "downloads", id] as const,
    downloadsImport: () =>
      [...queryKeys.library.all, "downloads-import"] as const,
    postProcessingSettings: () =>
      [...queryKeys.library.all, "post-processing-settings"] as const,
    languageTags: () => [...queryKeys.library.all, "language-tags"] as const,
    reindexLanguagesStatus: () =>
      [...queryKeys.library.all, "reindex-languages-status"] as const,
    remuxFileStatus: (fileId: number) =>
      [...queryKeys.library.all, "remux-file-status", fileId] as const,
    attention: () => [...queryKeys.library.all, "attention"] as const,
    rssStatus: () => [...queryKeys.library.all, "rss-status"] as const,
    downloadHistory: (params?: {
      page?: number;
      status?: string;
      days?: number;
    }) => [...queryKeys.library.all, "download-history", params] as const,
    downloadHistoryStats: () =>
      [...queryKeys.library.all, "download-history-stats"] as const,
    stats: () => [...queryKeys.library.all, "stats"] as const,
  },

  qualityProfiles: {
    all: ["quality-profiles"] as const,
    list: () => [...queryKeys.qualityProfiles.all, "list"] as const,
  },

  customFormats: {
    all: ["custom-formats"] as const,
    list: () => [...queryKeys.customFormats.all, "list"] as const,
  },

  blocklist: {
    all: ["blocklist"] as const,
    list: () => [...queryKeys.blocklist.all, "list"] as const,
  },

  indexerManager: {
    all: ["indexer-manager"] as const,
    indexers: () => [...queryKeys.indexerManager.all, "indexers"] as const,
  },
} as const;
