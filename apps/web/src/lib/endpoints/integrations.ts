export const INTEGRATION_ENDPOINTS = {
  JELLYFIN: "/api/integrations/jellyfin",
  PROWLARR: "/api/integrations/prowlarr",
  PROWLARR_INDEXERS: "/api/integrations/prowlarr/indexers",
  JACKETT: "/api/integrations/jackett",
  JACKETT_INDEXERS: "/api/integrations/jackett/indexers",
  DOWNLOAD_CLIENT: "/api/integrations/download-client",
  DOWNLOAD_CLIENT_TEST: "/api/integrations/download-client/test",
  DOWNLOAD_CLIENT_HOOK: "/api/integrations/download-client/hook",
  DOWNLOAD_CLIENT_HOOK_ROTATE: "/api/integrations/download-client/hook/rotate",
  TMDB: "/api/integrations/tmdb",
  FANART: "/api/integrations/fanart",
  OIDC: "/api/integrations/oidc",
  AI_PROVIDER: "/api/integrations/ai-provider",
  AI_PROVIDER_TEST: "/api/integrations/ai-provider/test",
  AI_PROVIDER_STATS: (days: number) =>
    `/api/integrations/ai-provider/stats?days=${days}`,
  AI_PROVIDER_CALLS: (params: {
    page: number;
    pageSize: number;
    feature?: string;
    status?: string;
  }) => {
    const search = new URLSearchParams({
      page: String(params.page),
      page_size: String(params.pageSize),
    });
    if (params.feature) search.set("feature", params.feature);
    if (params.status) search.set("status", params.status);
    return `/api/integrations/ai-provider/calls?${search.toString()}`;
  },
  GOOGLE_BOOKS: "/api/integrations/googlebooks",
  GOOGLE_BOOKS_TEST: "/api/integrations/googlebooks/test",
  NYT_BOOKS: "/api/integrations/nyt",
  NYT_BOOKS_TEST: "/api/integrations/nyt/test",
  AUDNEXUS: "/api/integrations/audnexus",
  AUDNEXUS_TEST: "/api/integrations/audnexus/test",
} as const;
