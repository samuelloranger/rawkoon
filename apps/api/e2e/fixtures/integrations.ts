import type { FixtureRegistry } from "./types";
import { mockState } from "../mocks/externals";

export const integrationsFixtures: FixtureRegistry = {
  // Audnexus
  "GET /api/integrations/audnexus": {
    phase: "read",
    admin: true,
    negativeBody: null,
  },
  "PUT /api/integrations/audnexus": {
    phase: "update",
    admin: true,
    body: () => ({
      enabled: true,
      base_url: "http://mock-audnexus.local",
      region: "us",
    }),
    negativeBody: { enabled: "nope", base_url: 123 },
  },
  "POST /api/integrations/audnexus/test": {
    phase: "action",
    admin: true,
    body: () => ({ base_url: "http://mock-audnexus.local", region: "us" }),
    negativeBody: { base_url: 123 },
  },

  // Download client
  "GET /api/integrations/download-client": {
    phase: "read",
    admin: true,
    negativeBody: null,
  },
  // Bootstrap a valid config so /test has something to exercise.
  "PUT /api/integrations/download-client": {
    phase: "bootstrap",
    admin: true,
    body: () => ({
      enabled: true,
      client_type: "qbittorrent",
      website_url: "http://mock-qbittorrent.local",
      username: "u",
      password: "p",
      label: "rawkoon",
    }),
    negativeBody: { client_type: "qbittorrent", website_url: 123 },
  },
  "GET /api/integrations/download-client/hook": {
    phase: "read",
    admin: true,
    negativeBody: null,
  },
  "PUT /api/integrations/download-client/hook": {
    phase: "update",
    admin: true,
    body: () => ({
      callbackUrl: "http://mock-download-hook.local",
      autoConfigure: false,
      activeHookedSecs: 120,
    }),
    negativeBody: { callbackUrl: 123 },
  },
  "POST /api/integrations/download-client/hook/rotate": {
    phase: "action",
    admin: true,
    negativeBody: null,
  },
  "POST /api/integrations/download-client/test": {
    phase: "action",
    admin: true,
    negativeBody: null,
  },

  // Google Books
  "GET /api/integrations/googlebooks": {
    phase: "read",
    admin: true,
    negativeBody: null,
  },
  "PUT /api/integrations/googlebooks": {
    phase: "update",
    admin: true,
    body: () => ({ enabled: true, api_key: "mock-googlebooks-key" }),
    negativeBody: { api_key: 123 },
  },
  "POST /api/integrations/googlebooks/test": {
    phase: "action",
    admin: true,
    body: () => ({ api_key: "mock-googlebooks-key" }),
    negativeBody: { api_key: 123 },
  },

  // Jackett
  "GET /api/integrations/jackett": {
    phase: "read",
    admin: true,
    negativeBody: null,
  },
  // Bootstrap so /indexers runs through the shim instead of the empty-config fast-path.
  "PUT /api/integrations/jackett": {
    phase: "bootstrap",
    admin: true,
    body: () => ({
      enabled: true,
      website_url: "http://mock-jackett.local",
      api_key: "mock-jackett-key",
      rss_indexers: [],
    }),
    negativeBody: { website_url: 123, api_key: 456 },
  },
  "GET /api/integrations/jackett/indexers": {
    phase: "read",
    admin: true,
    negativeBody: null,
  },

  // Jellyfin
  "GET /api/integrations/jellyfin": {
    phase: "read",
    admin: true,
    negativeBody: null,
  },
  "PUT /api/integrations/jellyfin": {
    phase: "update",
    admin: true,
    body: () => ({
      enabled: true,
      website_url: "http://mock-jellyfin.local",
      api_key: "mock-jellyfin-key",
    }),
    negativeBody: { website_url: 123, api_key: 456 },
  },

  // Local AI
  "GET /api/integrations/local-ai": {
    phase: "read",
    admin: true,
    negativeBody: null,
  },
  "PUT /api/integrations/local-ai": {
    phase: "bootstrap",
    admin: true,
    body: () => {
      // local-ai/test requires at least one model in the response; shape it so
      // the endpoint returns 200 under the global benign fetch shim.
      mockState.fetchResponses["mock-local-ai.local"] = {
        json: { data: [{ id: "e2e-model" }] },
      };
      return {
        enabled: true,
        base_url: "http://mock-local-ai.local",
        model: "e2e-model",
      };
    },
    negativeBody: { base_url: 123, model: false },
  },
  "GET /api/integrations/local-ai/test": {
    phase: "read",
    admin: true,
    negativeBody: null,
  },

  // OIDC providers
  "GET /api/integrations/oidc/": {
    phase: "read",
    admin: true,
    negativeBody: null,
  },
  "POST /api/integrations/oidc/": {
    phase: "bootstrap",
    admin: true,
    body: (ctx) => ({
      slug: `e2e-oidc-${ctx.get("requestId")}`,
      name: `E2E OIDC ${ctx.get("requestId")}`,
      discovery_url: "http://mock-oidc.local/.well-known/openid-configuration",
      client_id: "e2e-client-id",
      client_secret: "e2e-client-secret",
      enabled: true,
      icon_url: "http://mock-oidc.local/icon.png",
    }),
    captures: (body, ctx) => {
      const b = body as { provider?: { id?: unknown } };
      const id = b.provider?.id;
      if (typeof id === "string") ctx.set("oidcProviderTempId", id);
    },
    negativeBody: { slug: 123, discovery_url: "nope" },
  },
  "PUT /api/integrations/oidc/:id": {
    phase: "update",
    admin: true,
    pathParams: (ctx) => ({ id: ctx.get("oidcProviderTempId") }),
    body: (ctx) => ({
      name: `E2E OIDC ${ctx.get("requestId")} (updated)`,
      enabled: false,
    }),
    negativeBody: { enabled: "nope" },
  },
  "DELETE /api/integrations/oidc/:id": {
    phase: "delete",
    admin: true,
    pathParams: (ctx) => ({ id: ctx.get("oidcProviderTempId") }),
    negativeBody: null,
  },

  // Prowlarr
  "GET /api/integrations/prowlarr": {
    phase: "read",
    admin: true,
    negativeBody: null,
  },
  "PUT /api/integrations/prowlarr": {
    phase: "bootstrap",
    admin: true,
    body: () => {
      // ProwlarrAdapter.getIndexers expects a JSON array. The fetch shim's
      // default body is `{}`, so we pin an empty array for the sentinel host.
      mockState.fetchResponses["mock-prowlarr.local"] = { json: [] };
      return {
        enabled: true,
        website_url: "http://mock-prowlarr.local",
        api_key: "mock-prowlarr-key",
        rss_indexers: [],
      };
    },
    negativeBody: { website_url: 123, api_key: 456 },
  },
  "GET /api/integrations/prowlarr/indexers": {
    phase: "read",
    admin: true,
    negativeBody: null,
  },

  // TMDB
  "GET /api/integrations/tmdb": {
    phase: "read",
    admin: true,
    negativeBody: null,
  },
  "PUT /api/integrations/tmdb": {
    phase: "update",
    admin: true,
    body: () => ({
      enabled: true,
      api_key: "mock-tmdb-key",
      popularity_threshold: 15,
    }),
    negativeBody: { api_key: 123, popularity_threshold: "nope" },
  },
};
