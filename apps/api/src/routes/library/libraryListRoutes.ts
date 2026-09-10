import { Hono } from "hono";
import { z } from "zod";
import { Prisma } from "@prisma/client";

import { prisma } from "@rawkoon/api/db";
import { badRequest, notFound, ok, serverError } from "@rawkoon/api/errors";
import type { Env } from "@rawkoon/api/honoEnv";
import { ensureAdmin, requireUser } from "@rawkoon/api/middleware/hono/auth";
import { jsonV, queryV } from "@rawkoon/api/middleware/validate";
import { addOrUpdateLibraryFromTmdb } from "@rawkoon/api/services/libraryFromTmdb";
import { deleteCache } from "@rawkoon/api/services/cache";
import { TMDB_UPCOMING_CACHE_KEY } from "@rawkoon/api/utils/dashboard/tmdbUpcoming";
import { getGlobalTmdbRegion } from "@rawkoon/api/utils/medias/tmdbRegion";

import { mapLibraryMedia, libraryMediaInclude } from "./libraryHelpers";
import {
  parseLibrarySort,
  buildLibraryOrderBy,
  slicePage,
} from "./libraryListQuery";

const listQuery = z.object({
  type: z.string().optional(),
  status: z.string().optional(),
  q: z.string().optional(),
  language: z.string().optional(),
  page: z.coerce.number().optional(),
  limit: z.coerce.number().optional(),
  sort_by: z.string().optional(),
  sort_dir: z.string().optional(),
});

/**
 * Core CRUD: list, add, delete, and single-item fetch.
 * GET /api/library
 * POST /api/library
 * DELETE /api/library/:id
 * GET /api/library/item/:id
 */
export const libraryListRoutes = new Hono<Env>()
  .get("/", requireUser, queryV(listQuery), async (c) => {
    const query = c.req.valid("query");
    try {
      const { type, status, q, language, page, limit, sort_by, sort_dir } =
        query;
      const titleFilter = q
        ? { title: { contains: q, mode: "insensitive" as const } }
        : {};
      const sharedWhere: Prisma.LibraryMediaWhereInput = {
        ...(status ? { status } : {}),
        ...titleFilter,
        ...(language && language.length > 0
          ? { files: { some: { languageTags: { has: language } } } }
          : {}),
      };
      const typedWhere: Prisma.LibraryMediaWhereInput = {
        ...sharedWhere,
        ...(type ? { type } : {}),
      };

      const countsPromise = prisma.libraryMedia.groupBy({
        by: ["type"],
        where: sharedWhere,
        _count: true,
      });

      const paged = page !== undefined || limit !== undefined;
      const { sortBy, sortDir } = parseLibrarySort(sort_by, sort_dir);

      let mappedItems: ReturnType<typeof mapLibraryMedia>[];
      let has_more = false;

      if (!paged) {
        // Legacy full-list path (title asc) for non-Library-page callers.
        const items = await prisma.libraryMedia.findMany({
          where: typedWhere,
          orderBy: { title: "asc" },
          include: libraryMediaInclude,
          take: 5000,
        });
        mappedItems = items.map(mapLibraryMedia);
      } else {
        const take = Math.min(Math.max(1, limit ?? 60), 100);
        const skip = (Math.max(1, page ?? 1) - 1) * take;

        // All sorts (including former aggregates) use persisted columns +
        // Prisma orderBy so pagination stays skip/take in the database.
        const rows = await prisma.libraryMedia.findMany({
          where: typedWhere,
          orderBy: buildLibraryOrderBy(sortBy, sortDir),
          include: libraryMediaInclude,
          take: take + 1,
          skip,
        });
        const sliced = slicePage(rows, take);
        has_more = sliced.has_more;
        mappedItems = sliced.items.map(mapLibraryMedia);
      }

      const counts = await countsPromise;
      const movieCount = counts.find((c2) => c2.type === "movie")?._count ?? 0;
      const showCount = counts.find((c2) => c2.type === "show")?._count ?? 0;
      return ok({
        items: mappedItems,
        movie_count: movieCount,
        show_count: showCount,
        has_more,
      });
    } catch {
      return serverError("Failed to fetch library");
    }
  })

  .get("/item/:id", requireUser, async (c) => {
    try {
      const id = parseInt(c.req.param("id"), 10);
      if (!Number.isFinite(id)) return badRequest("Invalid id");
      const item = await prisma.libraryMedia.findUnique({
        where: { id },
        include: libraryMediaInclude,
      });
      if (!item) return notFound("Library item not found");
      return ok({ item: mapLibraryMedia(item) });
    } catch {
      return serverError("Failed to fetch library item");
    }
  })

  .post(
    "/",
    requireUser,
    jsonV(
      z.object({
        tmdb_id: z.number(),
        type: z.union([z.literal("movie"), z.literal("show")]),
      }),
    ),
    async (c) => {
      const denied = ensureAdmin(c.get("user"));
      if (denied) return denied;
      try {
        const { tmdb_id, type } = c.req.valid("json");
        if (type !== "movie" && type !== "show") {
          return badRequest("type must be 'movie' or 'show'");
        }
        try {
          const region = await getGlobalTmdbRegion();
          const item = await addOrUpdateLibraryFromTmdb({
            tmdb_id,
            type,
            region,
          });
          await deleteCache(`${TMDB_UPCOMING_CACHE_KEY}:${region}`);
          return ok({ item: mapLibraryMedia(item) });
        } catch (e) {
          const msg = e instanceof Error ? e.message : "";
          if (msg === "TMDB is not configured") {
            return badRequest(msg);
          }
          throw e;
        }
      } catch (err) {
        console.error("Library add error:", err);
        return serverError("Failed to add item to library");
      }
    },
  )

  // DELETE /api/library/:id — remove item (cascade deletes episodes + files)
  // ?delete_files=true also removes hardlinked/moved files from disk
  .delete(
    "/:id",
    requireUser,
    queryV(z.object({ delete_files: z.string().optional() })),
    async (c) => {
      const denied = ensureAdmin(c.get("user"));
      if (denied) return denied;
      try {
        const id = parseInt(c.req.param("id"), 10);
        const existing = await prisma.libraryMedia.findUnique({
          where: { id },
          include: {
            files: { select: { filePath: true } },
            downloadHistories: {
              select: { postProcessDestinationPath: true },
            },
          },
        });
        if (!existing) return notFound("Library item not found");

        if (c.req.valid("query").delete_files === "true") {
          const { rm } = await import("node:fs/promises");
          const paths = new Set<string>();
          for (const f of existing.files) paths.add(f.filePath);
          for (const dh of existing.downloadHistories) {
            if (dh.postProcessDestinationPath)
              paths.add(dh.postProcessDestinationPath);
          }
          await Promise.allSettled(
            [...paths].map((p) => rm(p, { force: true })),
          );
        }

        await prisma.$transaction([
          // Delete download history explicitly (onDelete: SetNull keeps orphans)
          prisma.downloadHistory.deleteMany({ where: { mediaId: id } }),
          // Cascade deletes episodes + MediaFile records
          prisma.libraryMedia.delete({ where: { id } }),
        ]);
        return ok({ success: true });
      } catch {
        return serverError("Failed to remove library item");
      }
    },
  );
