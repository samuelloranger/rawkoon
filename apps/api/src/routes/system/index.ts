import { Hono } from "hono";
import { ok, notFound } from "@rawkoon/api/errors";
import { getBooksEnabled } from "@rawkoon/api/services/settings/appSettings";
import { getAppVersion } from "@rawkoon/api/services/versionService";
import { prisma } from "@rawkoon/api/db";

// Mounted at /api/system by the edge, so
// routes here are declared relative to it.
export const systemRoutes = new Hono()
  .get("/version", () => ok({ version: getAppVersion() }))
  /**
   * Feature flags readable by any caller. /api/settings is admin-only, so the
   * books nav entry could never be gated for a non-admin without this.
   */
  .get("/features", async () => {
    const [booksEnabled, media] = await Promise.all([
      getBooksEnabled(),
      prisma.mediaSettings.findUnique({
        where: { id: 1 },
        select: { askBeforeAdding: true, requestersChooseSeasons: true },
      }),
    ]);
    // Clients decide whether an add or a request opens the dialog before any settings read.
    return ok({
      books_enabled: booksEnabled,
      ask_before_adding: media?.askBeforeAdding ?? true,
      requesters_choose_seasons: media?.requestersChooseSeasons ?? true,
    });
  })
  .notFound(() => notFound("Not found"));
