import { Hono } from "hono";
import { notFound } from "@rawkoon/api/errors";
import { type Env, honoOnError } from "@rawkoon/api/honoEnv";

import { bookListeningStatsRoutes } from "./bookListeningStatsRoutes";
import { bookListRoutes } from "./bookListRoutes";
import { bookEditionRoutes } from "./bookEditionRoutes";
import { bookGrabRoutes } from "./bookGrabRoutes";
import {
  bookContentRoutes,
  bookPlaybackRoutes,
  bookProgressRoutes,
  bookReadingProgressRoutes,
} from "./bookPlaybackRoutes";
import {
  bookMetadataAdminRoutes,
  bookMetadataRoutes,
} from "./bookMetadataRoutes";
import { bookOverridesRoutes } from "./bookOverridesRoutes";

export { mapBook, mapBookEdition, bookInclude } from "./bookHelpers";
export { bookQualityProfileRoutes } from "./bookQualityProfileRoutes";
export { authorRoutes } from "./authorRoutes";

/**
 * Books router — thin orchestrator, same shape as routes/library/index.ts.
 * Guards live per child (mixed): most are requireUser, bookMetadataAdminRoutes is
 * requireAdmin, and bookContentRoutes is unguarded (it authenticates via an HMAC
 * grant token). Mounted at /api/books by the edge (Elysia .mount strips prefix).
 *
 * bookListeningStatsRoutes and bookListRoutes must come before /:id routes:
 * literal /listening-stats and /search must not be swallowed as an :id.
 */
// Hono's .route() merge resolves overlaps by REGISTRATION ORDER (unlike Elysia's
// static-first router), so every router that owns a literal single-segment path
// (/progress, /reading-progress, /metadata-sources, …) must be registered BEFORE
// bookListRoutes, which owns GET/DELETE /:id — otherwise those literals get
// swallowed as an :id. bookListRoutes is therefore registered last.
export const bookRoutes = new Hono<Env>()
  .route("/", bookListeningStatsRoutes)
  .route("/", bookPlaybackRoutes)
  .route("/", bookContentRoutes)
  .route("/", bookProgressRoutes)
  .route("/", bookReadingProgressRoutes)
  .route("/", bookMetadataRoutes)
  .route("/", bookMetadataAdminRoutes)
  .route("/", bookOverridesRoutes)
  .route("/", bookEditionRoutes)
  .route("/", bookGrabRoutes)
  .route("/", bookListRoutes)
  .notFound(() => notFound("Not found"))
  .onError(honoOnError);
