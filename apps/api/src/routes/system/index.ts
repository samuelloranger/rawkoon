import { Hono } from "hono";
import { ok, notFound } from "@rawkoon/api/errors";
import { getBooksEnabled } from "@rawkoon/api/services/settings/appSettings";
import { getAppVersion } from "@rawkoon/api/services/versionService";
import { getAddDialogFlags } from "@rawkoon/api/services/library/seasonMonitoring";

// Mounted at /api/system by the edge, so
// routes here are declared relative to it.
export const systemRoutes = new Hono()
  .get("/version", () => ok({ version: getAppVersion() }))
  /**
   * Feature flags readable by any caller. /api/settings is admin-only, so the
   * books nav entry could never be gated for a non-admin without this.
   */
  .get("/features", async () => {
    const [booksEnabled, addDialog] = await Promise.all([
      getBooksEnabled(),
      getAddDialogFlags(),
    ]);
    return ok({ books_enabled: booksEnabled, ...addDialog });
  })
  .notFound(() => notFound("Not found"));
