import { Elysia, t } from "elysia";
import { Prisma } from "@prisma/client";

import { requireUser } from "@rawkoon/api/middleware/auth";
import { prisma } from "@rawkoon/api/db";
import { badRequest, notFound, serverError } from "@rawkoon/api/errors";
import {
  getBookMetadataProvider,
  BookProviderUnavailableError,
} from "@rawkoon/api/services/books";
import { addBookFromVolume } from "@rawkoon/api/services/books/bookLibrary";
import type { BookEditionKind } from "@rawkoon/shared/types";

import { bookInclude, mapBook } from "./bookHelpers";

const KINDS: BookEditionKind[] = ["ebook", "audiobook"];

/**
 * Books CRUD and provider search.
 *   GET    /api/books
 *   GET    /api/books/search
 *   GET    /api/books/:id
 *   POST   /api/books
 *   DELETE /api/books/:id
 */
export const bookListRoutes = new Elysia()
  .use(requireUser)

  .get(
    "/",
    async ({ query, set }) => {
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
        const items = (has_more ? rows.slice(0, take) : rows).map(mapBook);

        return { items, total, has_more };
      } catch (e) {
        console.error("[books] list failed:", e);
        return serverError(set, "Failed to list books");
      }
    },
    {
      query: t.Object({
        q: t.Optional(t.String()),
        kind: t.Optional(t.Union([t.Literal("ebook"), t.Literal("audiobook")])),
        status: t.Optional(t.String()),
        page: t.Optional(t.Numeric()),
        limit: t.Optional(t.Numeric()),
        sort_by: t.Optional(t.String()),
        sort_dir: t.Optional(t.String()),
      }),
    },
  )

  // Provider search for the add flow. Must be declared before /:id so "search"
  // is not swallowed as an id.
  .get(
    "/search",
    async ({ query, set }) => {
      const term = query.q?.trim();
      if (!term) return badRequest(set, "Query is required");

      const provider = await getBookMetadataProvider();
      if (!provider) {
        return badRequest(
          set,
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
          set.status = 503;
          return { error: `Google Books is unavailable: ${e.message}` };
        }
        console.error("[books] provider search failed:", e);
        return serverError(set, "Book search failed");
      }
    },
    { query: t.Object({ q: t.Optional(t.String()) }) },
  )

  .get(
    "/:id",
    async ({ params, set }) => {
      const book = await prisma.libraryBook.findUnique({
        where: { id: params.id },
        include: bookInclude,
      });
      if (!book) return notFound(set, "Book not found");
      return { item: mapBook(book) };
    },
    { params: t.Object({ id: t.Numeric() }) },
  )

  .post(
    "/",
    async ({ body, set }) => {
      const kinds = (
        body.kinds && body.kinds.length > 0 ? body.kinds : ["ebook"]
      ) as BookEditionKind[];
      if (kinds.some((k) => !KINDS.includes(k))) {
        return badRequest(set, "kinds must be ebook and/or audiobook");
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
        return serverError(set, "Failed to add book");
      }

      if (!result.added) {
        if (result.unavailable) {
          set.status = 503;
          return { error: result.reason };
        }
        if (result.reason === "Volume not found") {
          return notFound(set, result.reason);
        }
        return badRequest(set, result.reason);
      }

      const book = await prisma.libraryBook.findUnique({
        where: { id: result.bookId },
        include: bookInclude,
      });
      if (!book) return serverError(set, "Failed to add book");
      return { item: mapBook(book) };
    },
    {
      body: t.Object({
        google_volume_id: t.String(),
        // Pinned onto the volume and used to derive the stored language, so a
        // free-form string has no business reaching that far.
        isbn13: t.Optional(
          t.Nullable(t.String({ pattern: "^[0-9Xx][0-9Xx -]{8,20}$" })),
        ),
        kinds: t.Optional(
          t.Array(t.Union([t.Literal("ebook"), t.Literal("audiobook")])),
        ),
        book_quality_profile_id: t.Optional(t.Nullable(t.Numeric())),
        monitored: t.Optional(t.Boolean()),
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
      if (!existing) return notFound(set, "Book not found");
      // Editions and files cascade; library files on disk are left alone,
      // matching how removing a library media item behaves.
      await prisma.libraryBook.delete({ where: { id: params.id } });
      return { deleted: true };
    },
    { params: t.Object({ id: t.Numeric() }) },
  );
