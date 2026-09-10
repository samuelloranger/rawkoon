import { Hono } from "hono";
import { prisma } from "@rawkoon/api/db";
import { ok, notFound } from "@rawkoon/api/errors";
import { getAppVersion } from "@rawkoon/api/services/versionService";

// Mounted at /api/system by the edge, so
// routes here are declared relative to it.
export const systemRoutes = new Hono()
  .get("/version", () => ok({ version: getAppVersion() }))
  /**
   * Feature flags readable by any caller. /api/settings is admin-only, so the
   * books nav entry could never be gated for a non-admin without this.
   */
  .get("/features", async () => {
    const row = await prisma.appSettings.findUnique({
      where: { id: 1 },
      select: { booksEnabled: true },
    });
    return ok({ books_enabled: row?.booksEnabled ?? false });
  })
  .notFound(() => notFound("Not found"));
