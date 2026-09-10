import { Hono } from "hono";
import { notFound } from "@rawkoon/api/errors";
import { type Env, honoOnError } from "@rawkoon/api/honoEnv";
import { requireAdmin } from "@rawkoon/api/middleware/hono/auth";
import { tmdbIntegrationRoutes } from "./tmdb";
import { downloadClientIntegrationRoutes } from "./downloadClient";
import { jellyfinIntegrationRoutes } from "./jellyfin";
import { prowlarrIntegrationRoutes } from "./prowlarr";
import { jackettIntegrationRoutes } from "./jackett";
import { oidcIntegrationRoutes } from "./oidc";
import { localAiIntegrationRoutes } from "./local-ai";
import { googleBooksIntegrationRoutes } from "./googlebooks";
import { audnexusIntegrationRoutes } from "./audnexus";

// Mounted at /api/integrations by the edge.
// Every integration is admin-only, so one requireAdmin here propagates to all
// merged children. oidc carries its own /oidc segment.
export const integrationsRoutes = new Hono<Env>()
  .use("*", requireAdmin)
  .route("/", tmdbIntegrationRoutes)
  .route("/", downloadClientIntegrationRoutes)
  .route("/", jellyfinIntegrationRoutes)
  .route("/", prowlarrIntegrationRoutes)
  .route("/", jackettIntegrationRoutes)
  .route("/oidc", oidcIntegrationRoutes)
  .route("/", localAiIntegrationRoutes)
  .route("/", googleBooksIntegrationRoutes)
  .route("/", audnexusIntegrationRoutes)
  .notFound(() => notFound("Not found"))
  .onError(honoOnError);
