import { Hono } from "hono";
import type { Env } from "@rawkoon/api/honoEnv";
import { libraryAttentionRoutes } from "./libraryAttentionRoutes";
import { libraryJobStatsRoutes } from "./libraryJobStatsRoutes";
import { libraryJobWorkerRoutes } from "./libraryJobWorkerRoutes";

/**
 * Background jobs, SSE stream, stats, attention, language tags, remux, migrate, RSS status.
 * Composes libraryAttentionRoutes, libraryJobStatsRoutes, and libraryJobWorkerRoutes.
 * Guards are route-level in each child (requireUser, plus inline ensureAdmin in the
 * worker routes), so this composer adds none.
 */
export const libraryJobRoutes = new Hono<Env>()
  .route("/", libraryAttentionRoutes)
  .route("/", libraryJobStatsRoutes)
  .route("/", libraryJobWorkerRoutes);
