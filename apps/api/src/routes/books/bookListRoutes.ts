import { Elysia } from "elysia";
import { z } from "zod";
import { Prisma } from "@prisma/client";

import { requireUser } from "@rawkoon/api/middleware/auth";
import { prisma } from "@rawkoon/api/db";
import {
  badRequest,
  notFound,
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

/**
 * Books CRUD and provider search.
 *   GET    /api/books
 *   GET    /api/books/search
 *   GET    /api/books/:id
 *   PUT    /api/books/:id/read
 *   POST   /api/books
 *   DELETE /api/books/:id
 */
export const bookListRoutes = new Elysia()
  .use(requireUser)

  .get(
    "/",
    async ({ query, set, user }) => {
      try {
        const { q, kind, status, page, limit, sort_by, sort_dir } = query;

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
          user!.id,
          listed.map((b) => b.id),
        );
        const items = listed.map((b) =>
          mapBook(b, { readAt: readAt.get(b.id) ?? null }),
        );

        return { items, total, has_more };
      } catch (e) {
        console.error("[books] list failed:", e);
        return serverError("Failed to list books");
      }
    },
    {
      query: z.object({
        q: z.string().optional(),
        kind: z.union([z.literal("ebook"), z.literal("audiobook")]).optional(),
        status: z.string().optional(),
        page: z.coerce.number().optional(),
        limit: z.coerce.number().optional(),
        sort_by: z.string().optional(),
        sort_dir: z.string().optional(),
      }),
    },
  )

  // Provider search for the add flow. Must be declared before /:id so "search"
  // is not swallowed as an id.
  .get(
    "/search",
    async ({ query, set }) => {
      const term = query.q?.trim();
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

        return {
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
        };
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
    { query: z.object({ q: z.string().optional() }) },
  )

  .get(
    "/:id",
    async ({ params, set, user }) => {
      const book = await prisma.libraryBook.findUnique({
        where: { id: params.id },
        include: bookInclude,
      });
      if (!book) return notFound("Book not found");
      const readAt = await loadReadAtByBookId(prisma, user!.id, [book.id]);
      return { item: mapBook(book, { readAt: readAt.get(book.id) ?? null }) };
    },
    { params: z.object({ id: z.coerce.number() }) },
  )

  .put(
    "/:id/read",
    async ({ params, body, set, user }) => {
      const result = await setBookRead(prisma, {
        userId: user!.id,
        bookId: params.id,
        read: body.read,
      });
      if (!result.ok) return notFound("Book not found");
      const book = await prisma.libraryBook.findUnique({
        where: { id: params.id },
        include: bookInclude,
      });
      if (!book) return notFound("Book not found");
      return { item: mapBook(book, { readAt: result.readAt }) };
    },
    {
      params: z.object({ id: z.coerce.number() }),
      body: z.object({ read: z.boolean() }),
    },
  )

  .post(
    "/",
    async ({ body, set }) => {
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
      return { item: mapBook(book) };
    },
    {
      body: z.object({
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
    },
  )

  .delete(
    "/:id",
    async ({ params, set }) => {
      const existing = await prisma.libraryBook.findUnique({
        where: { id: params.id },
        select: { id: true },
      });
      if (!existing) return notFound("Book not found");
      // Editions and files cascade; library files on disk are left alone,
      // matching how removing a library media item behaves.
      await prisma.libraryBook.delete({ where: { id: params.id } });
      return { deleted: true };
    },
    { params: z.object({ id: z.coerce.number() }) },
  );
