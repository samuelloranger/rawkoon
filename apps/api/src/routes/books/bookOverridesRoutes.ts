import { Elysia, t } from "elysia";

import { requireUser } from "@rawkoon/api/middleware/auth";
import { prisma } from "@rawkoon/api/db";
import { badRequest, notFound, serverError } from "@rawkoon/api/errors";
import { sanitizeProviderHtml } from "@rawkoon/shared/utils";
import { refreshBookMetadata } from "@rawkoon/api/services/books/refreshBookMetadata";

import { bookInclude, mapBook } from "./bookHelpers";

/**
 * Manual metadata overrides.
 *
 *   PATCH /api/books/:id/overrides
 *
 * Mirrors PATCH /api/library/:id/overrides for movies and shows: each field is
 * optional and an explicit null clears it.
 *
 * Books differ in one way that matters. A movie applies its overrides at
 * display time, but a book's columns hold the *merged* result of the source
 * chain, so an override only reaches the column through a merge. Clearing a
 * field therefore cannot simply write null — the field has to fall back to
 * whatever the sources say. Both paths are handled by re-running the refresh,
 * whose provider responses are cached, so this is normally a local operation.
 *
 * `authors` is deliberately absent: LibraryBook.authors is maintained by a
 * trigger over the book_authors join table, so it is not a column this
 * mechanism can write.
 */

/**
 * Wire name -> stored key. The stored keys must match MERGEABLE_FIELDS, since
 * mergeBookMetadata looks overrides up by those names.
 */
const OVERRIDE_FIELDS = {
  title: "title",
  subtitle: "subtitle",
  series_name: "seriesName",
  series_position: "seriesPosition",
  narrators: "narrators",
  genres: "genres",
  publisher: "publisher",
  page_count: "pageCount",
  published_date: "publishedDate",
  published_year: "publishedYear",
  rating: "rating",
  rating_count: "ratingCount",
  language: "language",
  overview: "overview",
  cover_url: "coverUrl",
  isbn13: "isbn13",
} as const;

const nullable = <T extends ReturnType<typeof t.String>>(schema: T) =>
  t.Optional(t.Union([schema, t.Null()]));

export const bookOverridesRoutes = new Elysia().use(requireUser).patch(
  "/:id/overrides",
  async ({ params, body, set }) => {
    const id = Number(params.id);
    if (!Number.isInteger(id) || id <= 0)
      return badRequest(set, "Invalid book id");

    const existing = await prisma.libraryBook.findUnique({
      where: { id },
      select: { overrides: true },
    });
    if (!existing) return notFound(set, "Book not found");

    const current =
      existing.overrides &&
      typeof existing.overrides === "object" &&
      !Array.isArray(existing.overrides)
        ? { ...(existing.overrides as Record<string, unknown>) }
        : {};

    // Columns no provider may write. Clearing an override on one of these has
    // to explicitly re-authorise the column, or the reverted field would stay
    // frozen at the operator's value forever.
    const OVERRIDE_ONLY = new Set(["title", "language"]);
    const cleared: string[] = [];

    for (const [wire, stored] of Object.entries(OVERRIDE_FIELDS)) {
      if (!Object.hasOwn(body, wire)) continue;
      const value = (body as Record<string, unknown>)[wire];

      // null clears the override, handing the field back to the source chain.
      if (value === null) {
        if (Object.hasOwn(current, stored) && OVERRIDE_ONLY.has(stored)) {
          cleared.push(stored);
        }
        delete current[stored];
        continue;
      }
      // An empty string is a cleared text input, not an assertion of "".
      if (typeof value === "string" && !value.trim()) {
        if (Object.hasOwn(current, stored) && OVERRIDE_ONLY.has(stored)) {
          cleared.push(stored);
        }
        delete current[stored];
        continue;
      }

      if (stored === "overview" && typeof value === "string") {
        // The database only ever holds sanitized HTML, and this is operator
        // input reaching the same column a provider writes.
        current[stored] = sanitizeProviderHtml(value) || null;
        continue;
      }
      current[stored] = typeof value === "string" ? value.trim() : value;
    }

    try {
      await prisma.libraryBook.update({
        where: { id },
        data: { overrides: current as object },
      });

      // Recompute so the columns reflect the change: an override has to win,
      // and a cleared field has to fall back to what the sources supply.
      await refreshBookMetadata(id, { restoreColumns: cleared });

      const item = await prisma.libraryBook.findUnique({
        where: { id },
        include: bookInclude,
      });
      if (!item) return notFound(set, "Book not found");
      return { item: mapBook(item) };
    } catch (error) {
      console.error("Failed to update book overrides:", error);
      return serverError(set, "Failed to update overrides");
    }
  },
  {
    params: t.Object({ id: t.String() }),
    body: t.Object({
      title: nullable(t.String({ maxLength: 500 })),
      subtitle: nullable(t.String({ maxLength: 500 })),
      series_name: nullable(t.String({ maxLength: 300 })),
      series_position: t.Optional(t.Union([t.Number(), t.Null()])),
      narrators: t.Optional(t.Union([t.Array(t.String()), t.Null()])),
      genres: t.Optional(t.Union([t.Array(t.String()), t.Null()])),
      publisher: nullable(t.String({ maxLength: 300 })),
      page_count: t.Optional(t.Union([t.Number(), t.Null()])),
      published_date: nullable(t.String({ maxLength: 40 })),
      published_year: t.Optional(t.Union([t.Number(), t.Null()])),
      rating: t.Optional(t.Union([t.Number(), t.Null()])),
      rating_count: t.Optional(t.Union([t.Number(), t.Null()])),
      language: nullable(t.String({ maxLength: 10 })),
      overview: nullable(t.String({ maxLength: 20_000 })),
      cover_url: nullable(t.String({ maxLength: 2000 })),
      isbn13: nullable(t.String({ maxLength: 20 })),
    }),
  },
);
