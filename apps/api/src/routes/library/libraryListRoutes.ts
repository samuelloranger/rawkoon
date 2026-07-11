import { Elysia, t } from "elysia";
import { Prisma } from "@prisma/client";

import { requireUser, ensureAdmin } from "@rawkoon/api/middleware/auth";
import { prisma } from "@rawkoon/api/db";
import { badRequest, notFound, serverError } from "@rawkoon/api/errors";
import { addOrUpdateLibraryFromTmdb } from "@rawkoon/api/services/libraryFromTmdb";
import { deleteCache } from "@rawkoon/api/services/cache";
import { TMDB_UPCOMING_CACHE_KEY } from "@rawkoon/api/utils/dashboard/tmdbUpcoming";
import { getGlobalTmdbRegion } from "@rawkoon/api/utils/medias/tmdbRegion";

import { mapLibraryMedia, libraryMediaInclude } from "./libraryHelpers";
import {
  parseLibrarySort,
  isAggregateSort,
  buildSimpleOrderBy,
  slicePage,
  orderAggregateIds,
  reorderByIds,
  type AggregateSortRow,
} from "./libraryListQuery";

/**
 * Core CRUD: list, add, delete, and single-item fetch.
 * GET /api/library
 * POST /api/library
 * DELETE /api/library/:id
 * GET /api/library/item/:id
 */
export const libraryListRoutes = new Elysia()
  .use(requireUser)

  // GET /api/library — list library
  .get(
    "/",
    async ({ query, set }) => {
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

          if (!isAggregateSort(sortBy)) {
            const rows = await prisma.libraryMedia.findMany({
              where: typedWhere,
              orderBy: buildSimpleOrderBy(sortBy, sortDir),
              include: libraryMediaInclude,
              take: take + 1,
              skip,
            });
            const sliced = slicePage(rows, take);
            has_more = sliced.has_more;
            mappedItems = sliced.items.map(mapLibraryMedia);
          } else {
            // Aggregate sort: order lightweight rows, then fetch full records
            // only for the requested page.
            const lightRows = await prisma.libraryMedia.findMany({
              where: typedWhere,
              select: {
                id: true,
                title: true,
                overrides: true,
                files: { select: { sizeBytes: true } },
                episodes: {
                  select: { files: { select: { sizeBytes: true } } },
                },
                downloadHistories: {
                  orderBy: { grabbedAt: "desc" as const },
                  take: 1,
                  select: { grabbedAt: true },
                },
              },
            });
            const aggRows: AggregateSortRow[] = lightRows.map((r) => {
              let total = 0n;
              for (const f of r.files) total += f.sizeBytes;
              for (const ep of r.episodes)
                for (const f of ep.files) total += f.sizeBytes;
              const ov = (r.overrides ?? {}) as Record<string, unknown>;
              return {
                id: r.id,
                fileSizeTotal: total === 0n ? null : total,
                lastGrabbedAt:
                  r.downloadHistories[0]?.grabbedAt.getTime() ?? null,
                titleMapped: typeof ov.title === "string" ? ov.title : r.title,
              };
            });
            const orderedIds = orderAggregateIds(aggRows, sortBy, sortDir);
            const pageIdsPlusOne = orderedIds.slice(skip, skip + take + 1);
            const sliced = slicePage(pageIdsPlusOne, take);
            has_more = sliced.has_more;
            const pageRecords = await prisma.libraryMedia.findMany({
              where: { id: { in: sliced.items } },
              include: libraryMediaInclude,
            });
            mappedItems = reorderByIds(pageRecords, sliced.items).map(
              mapLibraryMedia,
            );
          }
        }

        const counts = await countsPromise;
        const movieCount = counts.find((c) => c.type === "movie")?._count ?? 0;
        const showCount = counts.find((c) => c.type === "show")?._count ?? 0;
        return {
          items: mappedItems,
          movie_count: movieCount,
          show_count: showCount,
          has_more,
        };
      } catch {
        return serverError(set, "Failed to fetch library");
      }
    },
    {
      query: t.Object({
        type: t.Optional(t.String()),
        status: t.Optional(t.String()),
        q: t.Optional(t.String()),
        language: t.Optional(t.String()),
        page: t.Optional(t.Numeric()),
        limit: t.Optional(t.Numeric()),
        sort_by: t.Optional(t.String()),
        sort_dir: t.Optional(t.String()),
      }),
    },
  )

  // GET /api/library/item/:id — single library item (integrations)
  .get("/item/:id", async ({ params, set }) => {
    try {
      const id = parseInt(params.id, 10);
      if (!Number.isFinite(id)) return badRequest(set, "Invalid id");
      const item = await prisma.libraryMedia.findUnique({
        where: { id },
        include: libraryMediaInclude,
      });
      if (!item) return notFound(set, "Library item not found");
      return { item: mapLibraryMedia(item) };
    } catch {
      return serverError(set, "Failed to fetch library item");
    }
  })

  // POST /api/library — add item by TMDB ID
  .post(
    "/",
    async ({ body, set, user }) => {
      const denied = ensureAdmin(user, set);
      if (denied) return denied;
      try {
        const { tmdb_id, type } = body;
        if (type !== "movie" && type !== "show") {
          return badRequest(set, "type must be 'movie' or 'show'");
        }
        try {
          const region = await getGlobalTmdbRegion();
          const item = await addOrUpdateLibraryFromTmdb({
            tmdb_id,
            type,
            region,
          });
          await deleteCache(`${TMDB_UPCOMING_CACHE_KEY}:${region}`);
          return { item: mapLibraryMedia(item) };
        } catch (e) {
          const msg = e instanceof Error ? e.message : "";
          if (msg === "TMDB is not configured") {
            return badRequest(set, msg);
          }
          throw e;
        }
      } catch (err) {
        console.error("Library add error:", err);
        return serverError(set, "Failed to add item to library");
      }
    },
    {
      body: t.Object({
        tmdb_id: t.Number(),
        type: t.Union([t.Literal("movie"), t.Literal("show")]),
      }),
    },
  )

  // DELETE /api/library/:id — remove item (cascade deletes episodes + files)
  // ?delete_files=true also removes hardlinked/moved files from disk
  .delete(
    "/:id",
    async ({ params, query, set, user }) => {
      const denied = ensureAdmin(user, set);
      if (denied) return denied;
      try {
        const id = parseInt(params.id, 10);
        const existing = await prisma.libraryMedia.findUnique({
          where: { id },
          include: {
            files: { select: { filePath: true } },
            downloadHistories: {
              select: { postProcessDestinationPath: true },
            },
          },
        });
        if (!existing) return notFound(set, "Library item not found");

        if (query.delete_files === "true") {
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
        return { success: true };
      } catch {
        return serverError(set, "Failed to remove library item");
      }
    },
    {
      query: t.Object({
        delete_files: t.Optional(t.String()),
      }),
    },
  );
