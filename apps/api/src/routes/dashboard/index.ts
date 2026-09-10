import { Hono } from "hono";
import { notFound } from "@rawkoon/api/errors";
import type { Env } from "@rawkoon/api/honoEnv";
import { dashboardActivitiesRoutes } from "./activities";
import { dashboardUpcomingRoutes } from "./upcoming";
import { dashboardJellyfinRoutes } from "./jellyfin";
import { dashboardDownloadsRoutes } from "./downloads";

// Mounted at /api/dashboard by the edge (Elysia .mount strips the prefix). Each
// child carries its own segment + requireUser guard; merge them at the root.
export const dashboardRoutes = new Hono<Env>()
  .route("/", dashboardActivitiesRoutes)
  .route("/", dashboardUpcomingRoutes)
  .route("/", dashboardJellyfinRoutes)
  .route("/", dashboardDownloadsRoutes)
  .notFound(() => notFound("Not found"));
