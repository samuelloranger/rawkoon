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
        const { type, status, q, language, page, limit } = query;
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
        const take = limit ? Math.min(Math.max(1, limit), 100) : 5000;
        const skip = page ? (Math.max(1, page) - 1) * take : undefined;

        const [items, counts] = await Promise.all([
          prisma.libraryMedia.findMany({
            where: { ...sharedWhere, ...(type ? { type } : {}) },
            orderBy: { title: "asc" },
            include: libraryMediaInclude,
            take,
            skip,
          }),
          prisma.libraryMedia.groupBy({
            by: ["type"],
            where: sharedWhere,
            _count: true,
          }),
        ]);
        const movieCount = counts.find((c) => c.type === "movie")?._count ?? 0;
        const showCount = counts.find((c) => c.type === "show")?._count ?? 0;
        return {
          items: items.map(mapLibraryMedia),
          movie_count: movieCount,
          show_count: showCount,
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
