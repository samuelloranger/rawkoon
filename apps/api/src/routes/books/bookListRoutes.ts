import { Hono } from "hono";
import { z } from "zod";

import type { Env } from "@rawkoon/api/honoEnv";
import { requireAdmin, requireUser } from "@rawkoon/api/middleware/hono/auth";
import { jsonV, paramV, queryV } from "@rawkoon/api/middleware/validate";
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
import { loadRequestsByVolumeId } from "@rawkoon/api/services/books/bookDiscovery";
import { addBookFromVolume } from "@rawkoon/api/services/books/bookLibrary";
import {
  findBookDetail,
  findBookDetailWithReadAt,
  findLibraryBooksByVolumeIds,
  listBooksPage,
  markBookRead,
  removeBook,
  resetProgressForBook,
} from "@rawkoon/api/services/books/bookListQueries";
import type { BookEditionKind } from "@rawkoon/shared/types";

import { mapBook } from "./bookHelpers";

const KINDS: BookEditionKind[] = ["ebook", "audiobook"];
const idParam = z.object({ id: z.coerce.number() });

/**
 * Books CRUD and provider search.
 *   GET    /api/books
 *   GET    /api/books/search
 *   GET    /api/books/:id
 *   PUT    /api/books/:id/read
 *   DELETE /api/books/:id/progress
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
        const { listed, total, hasMore, readAt } = await listBooksPage(
          user.id,
          c.req.valid("query"),
        );
        const items = listed.map((b) =>
          mapBook(b, { readAt: readAt.get(b.id) ?? null }),
        );

        return ok({ items, total, has_more: hasMore });
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
        const existing = await findLibraryBooksByVolumeIds(volumeIds);
        const byVolume = new Map(existing.map((e) => [e.googleVolumeId, e.id]));
        const requests = await loadRequestsByVolumeId(volumeIds);

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
            request: requests.get(b.volumeId) ?? null,
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
    const found = await findBookDetailWithReadAt(user.id, id);
    if (!found) return notFound("Book not found");
    return ok({ item: mapBook(found.book, { readAt: found.readAt }) });
  })

  .put(
    "/:id/read",
    requireUser,
    paramV(idParam),
    jsonV(z.object({ read: z.boolean() })),
    async (c) => {
      const user = c.get("user");
      const { id } = c.req.valid("param");
      const result = await markBookRead(user.id, id, c.req.valid("json").read);
      if (!result) return notFound("Book not found");
      return ok({ item: mapBook(result.book, { readAt: result.readAt }) });
    },
  )

  .delete("/:id/progress", requireUser, paramV(idParam), async (c) => {
    const user = c.get("user");
    const { id } = c.req.valid("param");
    if (!(await resetProgressForBook(user.id, id)))
      return notFound("Book not found");
    return ok({ ok: true });
  })

  .post(
    "/",
    requireAdmin,
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

      const book = await findBookDetail(result.bookId);
      if (!book) return serverError("Failed to add book");
      return ok({ item: mapBook(book) });
    },
  )

  .delete("/:id", requireAdmin, paramV(idParam), async (c) => {
    const { id } = c.req.valid("param");
    if (!(await removeBook(id))) return notFound("Book not found");
    return ok({ deleted: true });
  });
