export const LIBRARY_ENDPOINTS = {
  LIST: "/api/library",
  ITEM: (id: number) => `/api/library/item/${id}`,
  LIBRARY_STATS: "/api/library/stats",
  ADD: "/api/library",
  POST_PROCESSING_SETTINGS: "/api/library/post-processing/settings",
  SCAN: "/api/library/scan",
  REMOVE: (id: number) => `/api/library/${id}`,
  UPDATE_STATUS: (id: number) => `/api/library/${id}/status`,
  UPDATE_QUALITY_PROFILE: (id: number) => `/api/library/${id}/quality-profile`,
  EPISODES: (id: number) => `/api/library/${id}/episodes`,
  DOWNLOADS: (id: number) => `/api/library/${id}/downloads`,
  CLEAR_FAILED_DOWNLOADS: (id: number) => `/api/library/${id}/downloads/failed`,
  DOWNLOAD_ACTION: (id: number, dhId: number) =>
    `/api/library/${id}/downloads/${dhId}/action`,
  DELETE_DOWNLOAD_ENTRY: (mediaId: number, downloadHistoryId: number) =>
    `/api/library/${mediaId}/downloads/${downloadHistoryId}`,
  SEARCH: (id: number) => `/api/library/${id}/search`,
  GRAB: (id: number) => `/api/library/${id}/grab`,
  SEARCH_EPISODE: (mediaId: number, episodeId: number) =>
    `/api/library/${mediaId}/episodes/${episodeId}/search`,
  UPDATE_EPISODE_STATUS: (mediaId: number, episodeId: number) =>
    `/api/library/${mediaId}/episodes/${episodeId}/status`,
  RETRY_SKIPPED_SEASON: (mediaId: number, season: number) =>
    `/api/library/${mediaId}/seasons/${season}/retry-skipped`,
  SEARCH_SEASON: (mediaId: number, season: number) =>
    `/api/library/${mediaId}/seasons/${season}/search`,
  UPDATE_MONITORED: (id: number) => `/api/library/${id}/monitored`,
  UPDATE_EPISODE_MONITORED: (mediaId: number, episodeId: number) =>
    `/api/library/${mediaId}/episodes/${episodeId}/monitored`,
  UPDATE_SEASON_MONITORED: (mediaId: number, season: number) =>
    `/api/library/${mediaId}/seasons/${season}/monitored`,
  FILES: (id: number) => `/api/library/${id}/files`,
  RESCAN: (id: number) => `/api/library/${id}/rescan`,
  DELETE_FILE: (fileId: number) => `/api/library/files/${fileId}`,
  DELETE_EPISODE: (mediaId: number, episodeId: number) =>
    `/api/library/${mediaId}/episodes/${episodeId}`,
  RETRY_POST_PROCESS: (downloadHistoryId: number) =>
    `/api/library/downloads/${downloadHistoryId}/retry-post-process`,
  MIGRATE: "/api/library/migrate",
  MIGRATE_STATUS: "/api/library/migrate/status",
  LANGUAGE_TAGS: "/api/library/language-tags",
  REINDEX_LANGUAGES: "/api/library/reindex-languages",
  REINDEX_LANGUAGES_STATUS: "/api/library/reindex-languages/status",
  FILE_REMUX: (fileId: number) => `/api/library/files/${fileId}/remux`,
  FILE_REMUX_STATUS: (fileId: number) =>
    `/api/library/files/${fileId}/remux/status`,
  ATTENTION: "/api/library/attention",
  DISMISS_ATTENTION: (alertId: number) =>
    `/api/library/attention/${alertId}/dismiss`,
  RSS_STATUS: "/api/library/rss-status",
  DOWNLOAD_HISTORY: "/api/library/download-history",
  DOWNLOAD_HISTORY_STATS: "/api/library/download-history/stats",
  UPGRADE: (id: number) => `/api/library/${id}/upgrade`,
  UPDATE_OVERRIDES: (id: number) => `/api/library/${id}/overrides`,
  UPDATE_FILE: (fileId: number) => `/api/library/files/${fileId}`,
} as const;
