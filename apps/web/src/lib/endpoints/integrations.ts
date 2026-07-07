export const INTEGRATION_ENDPOINTS = {
  JELLYFIN: "/api/integrations/jellyfin",
  PROWLARR: "/api/integrations/prowlarr",
  PROWLARR_INDEXERS: "/api/integrations/prowlarr/indexers",
  JACKETT: "/api/integrations/jackett",
  JACKETT_INDEXERS: "/api/integrations/jackett/indexers",
  QBITTORRENT: "/api/integrations/qbittorrent",
  TMDB: "/api/integrations/tmdb",
  OIDC: "/api/integrations/oidc",
  LOCAL_AI: "/api/integrations/local-ai",
  LOCAL_AI_TEST: "/api/integrations/local-ai/test",
} as const;
