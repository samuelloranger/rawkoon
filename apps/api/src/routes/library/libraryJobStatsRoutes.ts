import { Hono } from "hono";
import { z } from "zod";

import { ok, serverError } from "@rawkoon/api/errors";
import type { Env } from "@rawkoon/api/honoEnv";
import { requireUser } from "@rawkoon/api/middleware/hono/auth";
import { queryV } from "@rawkoon/api/middleware/validate";
import { getLibraryGrowth } from "@rawkoon/api/services/library/libraryGrowth";
import {
  getDownloadHistoryStats,
  listDownloadHistory,
} from "@rawkoon/api/services/library/downloadHistoryQueries";
import {
  getLibraryStatsWithDisk,
  listLanguageTags,
} from "@rawkoon/api/services/library/libraryStatsQueries";

/**
 * GET /api/library/stats
 * GET /api/library/growth
 * GET /api/library/language-tags
 * GET /api/library/download-history
 * GET /api/library/download-history/stats
 */
export const libraryJobStatsRoutes = new Hono<Env>()
  .get("/stats", requireUser, async () => {
    try {
      const stats = await getLibraryStatsWithDisk();

      return ok({ stats });
    } catch {
      return serverError("Failed to fetch library stats");
    }
  })

  .get("/growth", requireUser, async (c) => {
    try {
      return ok({ growth: await getLibraryGrowth(c.get("user").is_admin) });
    } catch {
      return serverError("Failed to fetch library growth");
    }
  })

  .get("/language-tags", requireUser, async () => {
    try {
      const tags = await listLanguageTags();
      return ok({ tags });
    } catch {
      return serverError("Failed to fetch language tags");
    }
  })

  .get(
    "/download-history",
    requireUser,
    queryV(
      z.object({
        page: z.coerce.number().optional(),
        limit: z.coerce.number().optional(),
        status: z
          .union([
            z.literal("all"),
            z.literal("completed"),
            z.literal("failed"),
            z.literal("active"),
          ])
          .optional(),
        days: z.coerce.number().optional(),
      }),
    ),
    async (c) => {
      const query = c.req.valid("query");
      try {
        return ok(await listDownloadHistory(query));
      } catch {
        return serverError("Failed to fetch download history");
      }
    },
  )

  .get("/download-history/stats", requireUser, async () => {
    try {
      return ok({ stats: await getDownloadHistoryStats() });
    } catch {
      return serverError("Failed to fetch download history stats");
    }
  });
