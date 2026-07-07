import { Elysia } from "elysia";

import { requireUser } from "@rawkoon/api/middleware/auth";
import { libraryAttentionRoutes } from "./libraryAttentionRoutes";
import { libraryJobStatsRoutes } from "./libraryJobStatsRoutes";
import { libraryJobWorkerRoutes } from "./libraryJobWorkerRoutes";

/**
 * Background jobs, SSE stream, stats, attention, language tags, remux, migrate, RSS status.
 * Composes libraryAttentionRoutes, libraryJobStatsRoutes, and libraryJobWorkerRoutes.
 */
export const libraryJobRoutes = new Elysia()
  .use(requireUser)
  .use(libraryAttentionRoutes)
  .use(libraryJobStatsRoutes)
  .use(libraryJobWorkerRoutes);
