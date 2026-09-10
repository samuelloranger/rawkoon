import { Hono } from "hono";
import { notFound } from "@rawkoon/api/errors";
import { type Env, honoOnError } from "@rawkoon/api/honoEnv";
import { mediasTmdbRoutes } from "./tmdb";
import { mediasSearchRoutes } from "./search";
import { mediasWatchlistRoutes } from "./watchlist";
import { mediasCollectionsRoutes } from "./collections";
import { mediasBlocklistRoutes } from "./blocklist";
import { mediasDiscoverRoutes } from "./discover";

// Mounted at /api/medias by the edge. Guards are route-level in every child
// (mixed requireUser / requireAdmin), never `.use('*')`, so nothing leaks
// across these `/`-merged siblings. watchlist and discover keep their own
// /watchlist and /discover segments.
export const mediasRoutes = new Hono<Env>()
  .route("/", mediasTmdbRoutes)
  .route("/", mediasSearchRoutes)
  .route("/watchlist", mediasWatchlistRoutes)
  .route("/", mediasCollectionsRoutes)
  .route("/", mediasBlocklistRoutes)
  .route("/discover", mediasDiscoverRoutes)
  .notFound(() => notFound("Not found"))
  .onError(honoOnError);
