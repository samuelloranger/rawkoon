import { Elysia } from "elysia";
import { requireAdmin } from "@rawkoon/api/middleware/auth";
import { serverError } from "@rawkoon/api/errors";
import {
  getCachedGitHubReleases,
  refreshGitHubReleases,
} from "@rawkoon/api/services/githubReleases";

export const releasesRoutes = new Elysia({ prefix: "/api/releases" })
  .use(requireAdmin)
  .get("/", async ({ set }) => {
    try {
      const cached = await getCachedGitHubReleases();
      if (cached.releases.length > 0 || cached.sync.last_error) {
        return cached;
      }
      return await refreshGitHubReleases({ notifyAdmins: false });
    } catch (error) {
      console.error("Error loading GitHub releases:", error);
      return serverError(set, "Failed to load GitHub releases");
    }
  })
  .post("/refresh", async ({ set }) => {
    try {
      return await refreshGitHubReleases({ notifyAdmins: true });
    } catch (error) {
      console.error("Error refreshing GitHub releases:", error);
      return serverError(set, "Failed to refresh GitHub releases");
    }
  });
