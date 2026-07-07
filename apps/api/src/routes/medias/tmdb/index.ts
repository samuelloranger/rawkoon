import { Elysia } from "elysia";
import { auth } from "@rawkoon/api/auth";
import { tmdbSearchRoutes } from "./tmdbSearchRoutes";
import { tmdbExploreRoutes } from "./tmdbExploreRoutes";
import { tmdbMetaRoutes } from "./tmdbMetaRoutes";

export const mediasTmdbRoutes = new Elysia()
  .use(auth)
  .use(tmdbSearchRoutes)
  .use(tmdbExploreRoutes)
  .use(tmdbMetaRoutes);
