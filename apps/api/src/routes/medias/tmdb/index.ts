import { Hono } from "hono";
import type { Env } from "@rawkoon/api/honoEnv";
import { tmdbSearchRoutes } from "./tmdbSearchRoutes";
import { tmdbExploreRoutes } from "./tmdbExploreRoutes";
import { tmdbMetaRoutes } from "./tmdbMetaRoutes";

// requireUser is applied route-level in each sub-router (not `.use('*')` here),
// so the guard can't leak onto medias siblings merged after this at `/`.
export const mediasTmdbRoutes = new Hono<Env>()
  .route("/", tmdbSearchRoutes)
  .route("/", tmdbExploreRoutes)
  .route("/", tmdbMetaRoutes);
