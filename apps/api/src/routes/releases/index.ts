import { Hono } from "hono";
import { notFound, ok, serverError } from "@rawkoon/api/errors";
import type { Env } from "@rawkoon/api/honoEnv";
import { requireAdmin } from "@rawkoon/api/middleware/hono/auth";
import {
  getCachedGitHubReleases,
  refreshGitHubReleases,
} from "@rawkoon/api/services/githubReleases";

// Mounted at /api/releases by the edge (Elysia .mount strips the prefix).
export const releasesRoutes = new Hono<Env>()
  .use("*", requireAdmin)
  .get("/", async () => {
    try {
      const cached = await getCachedGitHubReleases();
      if (cached.releases.length > 0 || cached.sync.last_error) {
        return ok(cached);
      }
      return ok(await refreshGitHubReleases({ notifyAdmins: false }));
    } catch (error) {
      console.error("Error loading GitHub releases:", error);
      return serverError("Failed to load GitHub releases");
    }
  })
  .post("/refresh", async () => {
    try {
      return ok(await refreshGitHubReleases({ notifyAdmins: true }));
    } catch (error) {
      console.error("Error refreshing GitHub releases:", error);
      return serverError("Failed to refresh GitHub releases");
    }
  })
  .notFound(() => notFound("Not found"));
