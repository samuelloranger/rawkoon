import { Elysia } from "elysia";
import { mediasTmdbRoutes } from "./tmdb";
import { mediasSearchRoutes } from "./search";
import { mediasWatchlistRoutes } from "./watchlist";
import { mediasCollectionsRoutes } from "./collections";
import { mediasBlocklistRoutes } from "./blocklist";
import { mediasDiscoverRoutes } from "./discover";

export const mediasRoutes = new Elysia({ prefix: "/api/medias" })
  .use(mediasTmdbRoutes)
  .use(mediasSearchRoutes)
  .use(mediasWatchlistRoutes)
  .use(mediasCollectionsRoutes)
  .use(mediasBlocklistRoutes)
  .use(mediasDiscoverRoutes);
