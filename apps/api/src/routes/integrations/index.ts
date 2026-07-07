import { Elysia } from "elysia";
import { tmdbIntegrationRoutes } from "./tmdb";
import { qbittorrentIntegrationRoutes } from "./qbittorrent";
import { jellyfinIntegrationRoutes } from "./jellyfin";
import { prowlarrIntegrationRoutes } from "./prowlarr";
import { jackettIntegrationRoutes } from "./jackett";
import { oidcIntegrationRoutes } from "./oidc";
import { localAiIntegrationRoutes } from "./local-ai";

export const integrationsRoutes = new Elysia({ prefix: "/api/integrations" })
  .use(tmdbIntegrationRoutes)
  .use(qbittorrentIntegrationRoutes)
  .use(jellyfinIntegrationRoutes)
  .use(prowlarrIntegrationRoutes)
  .use(jackettIntegrationRoutes)
  .use(oidcIntegrationRoutes)
  .use(localAiIntegrationRoutes);
