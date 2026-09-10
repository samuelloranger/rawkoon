import { Hono } from "hono";
import type { Env } from "@rawkoon/api/honoEnv";
import { requireUser } from "@rawkoon/api/middleware/hono/auth";
import { tmdbSearchRoutes } from "./tmdbSearchRoutes";
import { tmdbExploreRoutes } from "./tmdbExploreRoutes";
import { tmdbMetaRoutes } from "./tmdbMetaRoutes";

// All three TMDB sub-routers are requireUser, so one guard here covers them.
export const mediasTmdbRoutes = new Hono<Env>()
  .use("*", requireUser)
  .route("/", tmdbSearchRoutes)
  .route("/", tmdbExploreRoutes)
  .route("/", tmdbMetaRoutes);
