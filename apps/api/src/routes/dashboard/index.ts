import { Elysia } from "elysia";
import { dashboardActivitiesRoutes } from "./activities";
import { dashboardUpcomingRoutes } from "./upcoming";
import { dashboardJellyfinRoutes } from "./jellyfin";
import { dashboardDownloadsRoutes } from "./downloads";

export const dashboardRoutes = new Elysia({ prefix: "/api/dashboard" })
  .use(dashboardActivitiesRoutes)
  .use(dashboardUpcomingRoutes)
  .use(dashboardJellyfinRoutes)
  .use(dashboardDownloadsRoutes);
