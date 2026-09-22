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

import {
  DEFAULT_TITLE_LANGUAGE,
  normalizeTitleLanguage,
} from "@rawkoon/shared/constants";

import { mapLibraryMedia, libraryMediaInclude } from "./libraryHelpers";
import {
  buildLocalizedCountQuery,
  buildLocalizedIdQuery,
} from "./libraryLocalizedListQuery";
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
  title_language: z.string().optional(),
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
      const titleLanguage = normalizeTitleLanguage(query.title_language);
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

      const countsPromise =
        titleLanguage !== DEFAULT_TITLE_LANGUAGE && q
          ? prisma.$queryRaw<{ type: string; _count: number }[]>(
              buildLocalizedCountQuery({
                language: titleLanguage,
                status,
                q,
                fileLanguage: language,
              }),
            )
          : prisma.libraryMedia.groupBy({
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
        mappedItems = items.map((r) => mapLibraryMedia(r, titleLanguage));
        if (titleLanguage !== DEFAULT_TITLE_LANGUAGE) {
          // This path sorts in SQL on the English title; re-sort on what the
          // caller will actually see.
          mappedItems.sort((a, b) =>
            a.title.localeCompare(b.title, titleLanguage, {
              sensitivity: "base",
            }),
          );
        }
      } else {
        const take = Math.min(Math.max(1, limit ?? 60), 100);
        const skip = (Math.max(1, page ?? 1) - 1) * take;

        // All sorts (including former aggregates) use persisted columns +
        // Prisma orderBy so pagination stays skip/take in the database.
        if (titleLanguage === DEFAULT_TITLE_LANGUAGE) {
          // English keeps the pure-Prisma path: persisted columns, skip/take.
          const rows = await prisma.libraryMedia.findMany({
            where: typedWhere,
            orderBy: buildLibraryOrderBy(sortBy, sortDir),
            include: libraryMediaInclude,
            take: take + 1,
            skip,
          });
          const sliced = slicePage(rows, take);
          has_more = sliced.has_more;
          mappedItems = sliced.items.map((r) => mapLibraryMedia(r));
        } else {
          // Prisma cannot order by a to-many relation column, so resolve the
          // page's ids in SQL and hydrate them through the normal include.
          const idRows = await prisma.$queryRaw<{ id: number }[]>(
            buildLocalizedIdQuery({
              language: titleLanguage,
              type,
              status,
              q,
              fileLanguage: language,
              sortBy,
              sortDir,
              take: take + 1,
              skip,
            }),
          );
          const sliced = slicePage(idRows, take);
          has_more = sliced.has_more;
          const ids = sliced.items.map((r) => r.id);
          const rows = await prisma.libraryMedia.findMany({
            where: { id: { in: ids } },
            include: libraryMediaInclude,
          });
          const byId = new Map(rows.map((r) => [r.id, r]));
          mappedItems = ids
            .map((id) => byId.get(id))
            .filter((r): r is (typeof rows)[number] => r !== undefined)
            .map((r) => mapLibraryMedia(r, titleLanguage));
        }
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
      const itemTitleLanguage = normalizeTitleLanguage(
        c.req.query("title_language"),
      );
      return ok({ item: mapLibraryMedia(item, itemTitleLanguage) });
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
  // ?release_torrents=true removes still-seeding torrents now instead of at their target
  .delete(
    "/:id",
    requireUser,
    queryV(
      z.object({
        delete_files: z.string().optional(),
        release_torrents: z.string().optional(),
      }),
    ),
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
              select: {
                id: true,
                torrentHash: true,
                completedAt: true,
                failed: true,
                seedReleasedAt: true,
                postProcessDestinationPath: true,
              },
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

        const pending = existing.downloadHistories.filter(
          (dh) => dh.completedAt == null && !dh.failed,
        );
        const { abandonPendingDownloads, protectedHashes, releaseTorrentNow } =
          await import("@rawkoon/api/services/seeding/seedSweep");
        await abandonPendingDownloads(pending);

        let released = 0;
        if (c.req.valid("query").release_torrents === "true") {
          const held = new Set(
            existing.downloadHistories
              .filter(
                (dh) =>
                  dh.completedAt != null &&
                  !dh.failed &&
                  dh.seedReleasedAt == null &&
                  dh.torrentHash,
              )
              .map((dh) => (dh.torrentHash as string).toLowerCase()),
          );
          // Never release (and stamp) a torrent another title still owns.
          const shared = await protectedHashes(
            [...held],
            existing.downloadHistories.map((dh) => dh.id),
          );
          for (const hash of held) {
            if (shared.has(hash)) continue;
            const result = await releaseTorrentNow(hash).catch(() => null);
            if (result?.status === "released") released += 1;
          }
        }

        // DownloadHistory rows are kept (media_id → NULL) so their torrents keep seeding to target.
        // Cascade deletes episodes + MediaFile records.
        await prisma.libraryMedia.delete({ where: { id } });
        return ok({ success: true, released });
      } catch {
        return serverError("Failed to remove library item");
      }
    },
  );
