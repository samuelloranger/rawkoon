import { Elysia } from "elysia";
import { auth } from "@rawkoon/api/auth";

import { libraryListRoutes } from "./libraryListRoutes";
import { libraryMetaRoutes } from "./libraryMetaRoutes";
import { libraryGrabRoutes } from "./libraryGrabRoutes";
import { libraryFilesRoutes } from "./libraryFilesRoutes";
import { libraryJobRoutes } from "./libraryJobRoutes";

// Re-export helpers consumed by other parts of the codebase
export { mapLibraryMedia, libraryMediaInclude } from "./libraryHelpers";

/**
 * Main library router — thin orchestrator that wires sub-routers together.
 * Individual domains live in their own files:
 *   libraryListRoutes  — GET /, POST /, DELETE /:id, GET /item/:id
 *   libraryMetaRoutes  — PATCH /:id/status, monitored, quality-profile, seasons/*, episodes/*
 *   libraryGrabRoutes  — POST /:id/grab, search, episodes search, seasons search, upgrade
 *   libraryFilesRoutes — GET/:id/files, rescan, DELETE files/:fileId, episodes/:epId
 *   libraryJobRoutes   — composes attention, stats, and worker job routes
 */
export const libraryRoutes = new Elysia({ prefix: "/api/library" })
  .use(auth)
  .use(libraryListRoutes)
  .use(libraryMetaRoutes)
  .use(libraryGrabRoutes)
  .use(libraryFilesRoutes)
  .use(libraryJobRoutes);
