import { Elysia } from "elysia";
import { tmdbIntegrationRoutes } from "./tmdb";
import { downloadClientIntegrationRoutes } from "./downloadClient";
import { jellyfinIntegrationRoutes } from "./jellyfin";
import { prowlarrIntegrationRoutes } from "./prowlarr";
import { jackettIntegrationRoutes } from "./jackett";
import { oidcIntegrationRoutes } from "./oidc";
import { localAiIntegrationRoutes } from "./local-ai";
import { googleBooksIntegrationRoutes } from "./googlebooks";

export const integrationsRoutes = new Elysia({ prefix: "/api/integrations" })
  .use(tmdbIntegrationRoutes)
  .use(downloadClientIntegrationRoutes)
  .use(jellyfinIntegrationRoutes)
  .use(prowlarrIntegrationRoutes)
  .use(jackettIntegrationRoutes)
  .use(oidcIntegrationRoutes)
  .use(localAiIntegrationRoutes)
  .use(googleBooksIntegrationRoutes);
