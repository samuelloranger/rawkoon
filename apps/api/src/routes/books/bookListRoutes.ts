import { Hono } from "hono";
import { z } from "zod";
import { Prisma } from "@prisma/client";

import type { Env } from "@rawkoon/api/honoEnv";
import { requireUser } from "@rawkoon/api/middleware/hono/auth";
import { jsonV, paramV, queryV } from "@rawkoon/api/middleware/validate";
import { prisma } from "@rawkoon/api/db";
import {
  badRequest,
  notFound,
  ok,
  serverError,
  serviceUnavailable,
} from "@rawkoon/api/errors";
import {
  getBookMetadataProvider,
  BookProviderUnavailableError,
} from "@rawkoon/api/services/books";
import { addBookFromVolume } from "@rawkoon/api/services/books/bookLibrary";
import {
  loadReadAtByBookId,
  setBookRead,
} from "@rawkoon/api/services/books/setBookRead";
import type { BookEditionKind } from "@rawkoon/shared/types";

import { bookInclude, mapBook } from "./bookHelpers";

const KINDS: BookEditionKind[] = ["ebook", "audiobook"];
const idParam = z.object({ id: z.coerce.number() });

/**
 * Books CRUD and provider search.
 *   GET    /api/books
 *   GET    /api/books/search
 *   GET    /api/books/:id
 *   PUT    /api/books/:id/read
 *   POST   /api/books
 *   DELETE /api/books/:id
 */
export const bookListRoutes = new Hono<Env>()
  .get(
    "/",
    requireUser,
    queryV(
      z.object({
        q: z.string().optional(),
        kind: z.union([z.literal("ebook"), z.literal("audiobook")]).optional(),
        status: z.string().optional(),
        page: z.coerce.number().optional(),
        limit: z.coerce.number().optional(),
        sort_by: z.string().optional(),
        sort_dir: z.string().optional(),
      }),
    ),
    async (c) => {
      const user = c.get("user");
      try {
        const { q, kind, status, page, limit, sort_by, sort_dir } =
          c.req.valid("query");

        const where: Prisma.LibraryBookWhereInput = {
          ...(q
            ? { title: { contains: q, mode: "insensitive" as const } }
            : {}),
          ...(kind || status
            ? {
                editions: {
                  some: {
                    ...(kind ? { kind } : {}),
                    ...(status ? { status } : {}),
                  },
                },
              }
            : {}),
        };

        const dir = sort_dir === "asc" ? "asc" : "desc";
        const orderBy: Prisma.LibraryBookOrderByWithRelationInput =
          sort_by === "title"
            ? { listTitle: dir }
            : sort_by === "year"
              ? { listYear: dir }
              : { addedAt: dir };

        const take = Math.min(200, Math.max(1, limit ?? 50));
        const skip = Math.max(0, ((page ?? 1) - 1) * take);

        const [total, rows] = await Promise.all([
          prisma.libraryBook.count({ where }),
          prisma.libraryBook.findMany({
            where,
            orderBy,
            include: bookInclude,
            skip,
            take: take + 1,
          }),
        ]);

        const has_more = rows.length > take;
        const listed = has_more ? rows.slice(0, take) : rows;
        const readAt = await loadReadAtByBookId(
          prisma,
          user.id,
          listed.map((b) => b.id),
        );
        const items = listed.map((b) =>
          mapBook(b, { readAt: readAt.get(b.id) ?? null }),
        );

        return ok({ items, total, has_more });
      } catch (e) {
        console.error("[books] list failed:", e);
        return serverError("Failed to list books");
      }
    },
  )

  // Provider search for the add flow. Must be declared before /:id so "search"
  // is not swallowed as an id.
  .get(
    "/search",
    requireUser,
    queryV(z.object({ q: z.string().optional() })),
    async (c) => {
      const term = c.req.valid("query").q?.trim();
      if (!term) return badRequest("Query is required");

      const provider = await getBookMetadataProvider();
      if (!provider) {
        return badRequest(
          "Google Books is not configured. Add an API key in Integrations.",
        );
      }

      try {
        const found = await provider.searchBooks(term, { limit: 20 });
        const volumeIds = found.map((b) => b.volumeId);
        const existing = await prisma.libraryBook.findMany({
          where: { googleVolumeId: { in: volumeIds } },
          select: { id: true, googleVolumeId: true },
        });
        const byVolume = new Map(existing.map((e) => [e.googleVolumeId, e.id]));

        return ok({
          results: found.map((b) => ({
            google_volume_id: b.volumeId,
            title: b.title,
            subtitle: b.subtitle,
            authors: b.authors,
            language: b.language,
            published_year: b.publishedYear,
            isbn13: b.isbn13,
            cover_url: b.coverUrl,
            overview: b.overview,
            in_library: byVolume.has(b.volumeId),
            library_book_id: byVolume.get(b.volumeId) ?? null,
          })),
        });
      } catch (e) {
        // The provider being unavailable is NOT "no results" — saying otherwise
        // would report a transient 503 as "this book does not exist".
        if (e instanceof BookProviderUnavailableError) {
          return serviceUnavailable(
            `Google Books is unavailable: ${e.message}`,
          );
        }
        console.error("[books] provider search failed:", e);
        return serverError("Book search failed");
      }
    },
  )

  .get("/:id", requireUser, paramV(idParam), async (c) => {
    const user = c.get("user");
    const { id } = c.req.valid("param");
    const book = await prisma.libraryBook.findUnique({
      where: { id },
      include: bookInclude,
    });
    if (!book) return notFound("Book not found");
    const readAt = await loadReadAtByBookId(prisma, user.id, [book.id]);
    return ok({ item: mapBook(book, { readAt: readAt.get(book.id) ?? null }) });
  })

  .put(
    "/:id/read",
    requireUser,
    paramV(idParam),
    jsonV(z.object({ read: z.boolean() })),
    async (c) => {
      const user = c.get("user");
      const { id } = c.req.valid("param");
      const result = await setBookRead(prisma, {
        userId: user.id,
        bookId: id,
        read: c.req.valid("json").read,
      });
      if (!result.ok) return notFound("Book not found");
      const book = await prisma.libraryBook.findUnique({
        where: { id },
        include: bookInclude,
      });
      if (!book) return notFound("Book not found");
      return ok({ item: mapBook(book, { readAt: result.readAt }) });
    },
  )

  .post(
    "/",
    requireUser,
    jsonV(
      z.object({
        google_volume_id: z.string(),
        isbn13: z
          .string()
          .regex(new RegExp("^[0-9Xx][0-9Xx -]{8,20}$"))
          .nullable()
          .optional(),
        kinds: z
          .array(z.union([z.literal("ebook"), z.literal("audiobook")]))
          .optional(),
        book_quality_profile_id: z.coerce.number().nullable().optional(),
        monitored: z.boolean().optional(),
      }),
    ),
    async (c) => {
      const body = c.req.valid("json");
      const kinds = (
        body.kinds && body.kinds.length > 0 ? body.kinds : ["ebook"]
      ) as BookEditionKind[];
      if (kinds.some((k) => !KINDS.includes(k))) {
        return badRequest("kinds must be ebook and/or audiobook");
      }

      let result;
      try {
        result = await addBookFromVolume({
          volumeId: body.google_volume_id ?? "",
          kinds,
          bookQualityProfileId: body.book_quality_profile_id,
          monitored: body.monitored,
          isbn13: body.isbn13,
        });
      } catch (e) {
        console.error("[books] add failed:", e);
        return serverError("Failed to add book");
      }

      if (!result.added) {
        if (result.unavailable) {
          return serviceUnavailable(result.reason);
        }
        if (result.reason === "Volume not found") {
          return notFound(result.reason);
        }
        return badRequest(result.reason);
      }

      const book = await prisma.libraryBook.findUnique({
        where: { id: result.bookId },
        include: bookInclude,
      });
      if (!book) return serverError("Failed to add book");
      return ok({ item: mapBook(book) });
    },
  )

  .delete("/:id", requireUser, paramV(idParam), async (c) => {
    const { id } = c.req.valid("param");
    const existing = await prisma.libraryBook.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) return notFound("Book not found");
    // Editions and files cascade; library files on disk are left alone,
    // matching how removing a library media item behaves.
    await prisma.libraryBook.delete({ where: { id } });
    return ok({ deleted: true });
  });
