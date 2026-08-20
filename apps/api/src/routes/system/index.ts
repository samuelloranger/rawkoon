import { Elysia } from "elysia";
import { prisma } from "@rawkoon/api/db";
import { getAppVersion } from "@rawkoon/api/services/versionService";

export const systemRoutes = new Elysia({ prefix: "/api/system" })
  .get("/version", () => ({
    version: getAppVersion(),
  }))
  /**
   * Feature flags readable by any caller. /api/settings is admin-only, so the
   * books nav entry could never be gated for a non-admin without this.
   */
  .get("/features", async () => {
    const row = await prisma.appSettings.findUnique({
      where: { id: 1 },
      select: { booksEnabled: true },
    });
    return { books_enabled: row?.booksEnabled ?? false };
  });
