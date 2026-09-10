import { Hono } from "hono";
import { notFound } from "@rawkoon/api/errors";
import { type Env, honoOnError } from "@rawkoon/api/honoEnv";

import { libraryListRoutes } from "./libraryListRoutes";
import { libraryMetaRoutes } from "./libraryMetaRoutes";
import { libraryGrabRoutes } from "./libraryGrabRoutes";
import { libraryFilesRoutes } from "./libraryFilesRoutes";
import { libraryJobRoutes } from "./libraryJobRoutes";
import { libraryMediaAdminRoutes } from "./libraryMediaAdmin";
import { libraryDownloadsRoutes } from "./downloads";

// Re-export helpers consumed by other parts of the codebase
export { mapLibraryMedia, libraryMediaInclude } from "./libraryHelpers";

/**
 * Main library router — one Hono app mounted at /api/library by the edge. All
 * the /api/library routers are combined here (libraryMediaAdminRoutes and
 * libraryDownloadsRoutes shared the /api/library prefix and used to be mounted
 * separately; they fold in here since three apps cannot .mount at one prefix).
 * Guards are route-level in each child (mixed requireUser / requireAdmin, plus
 * inline ensureAdmin) so none is hoisted here.
 *   libraryListRoutes  — GET /, POST /, DELETE /:id, GET /item/:id
 *   libraryMetaRoutes  — PATCH /:id/status, monitored, quality-profile, seasons/*, episodes/*
 *   libraryGrabRoutes  — POST /:id/grab, search, episodes search, seasons search, upgrade
 *   libraryFilesRoutes — GET /:id/files, rescan, DELETE files/:fileId, downloads actions
 *   libraryJobRoutes   — composes attention, stats, and worker job routes (SSE)
 *   libraryMediaAdmin  — admin media edits
 *   libraryDownloads   — /downloads (admin)
 */
export const libraryRoutes = new Hono<Env>()
  .route("/", libraryListRoutes)
  .route("/", libraryMetaRoutes)
  .route("/", libraryGrabRoutes)
  .route("/", libraryFilesRoutes)
  .route("/", libraryJobRoutes)
  .route("/", libraryMediaAdminRoutes)
  .route("/downloads", libraryDownloadsRoutes)
  .notFound(() => notFound("Not found"))
  .onError(honoOnError);
