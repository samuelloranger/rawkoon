import { Elysia, t } from "elysia";

import { requireUser } from "@rawkoon/api/middleware/auth";
import { prisma } from "@rawkoon/api/db";
import { badRequest, notFound, serverError } from "@rawkoon/api/errors";
import { sanitizeProviderHtml } from "@rawkoon/shared/utils";
import { refreshBookMetadata } from "@rawkoon/api/services/books/refreshBookMetadata";
import { serializePerBook } from "@rawkoon/api/services/books/refreshQueue";
import { parseIsoDate } from "@rawkoon/api/utils/books/isoDate";

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
 * whatever the sources say, or be emptied when they say nothing. Both paths go
 * through the refresh, whose provider responses are cached, so this is normally
 * a local operation.
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

const nullableStr = (max: number) =>
  t.Optional(t.Union([t.String({ maxLength: max }), t.Null()]));

/**
 * Integer columns must reject fractions at the edge.
 *
 * The override JSON is written before the merge converts it into a column, so
 * a value Postgres cannot store would persist in the JSON and make every later
 * refresh of that book fail — the bad value would outlive the request that
 * introduced it.
 */
const nullableInt = (min: number, max: number) =>
  t.Optional(t.Union([t.Integer({ minimum: min, maximum: max }), t.Null()]));

export const bookOverridesRoutes = new Elysia().use(requireUser).patch(
  "/:id/overrides",
  async ({ params, body, set }) => {
    const id = Number(params.id);
    if (!Number.isInteger(id) || id <= 0)
      return badRequest(set, "Invalid book id");

    const existing = await prisma.libraryBook.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) return notFound(set, "Book not found");

    const patch: Record<string, unknown> = {};
    const removed: string[] = [];

    for (const [wire, stored] of Object.entries(OVERRIDE_FIELDS)) {
      if (!Object.hasOwn(body, wire)) continue;
      const value = (body as Record<string, unknown>)[wire];

      // null, or an empty text box, clears the override. An empty input means
      // "I do not want to set this", never "the value is the empty string".
      if (value === null || (typeof value === "string" && !value.trim())) {
        removed.push(stored);
        continue;
      }

      if (stored === "publishedDate" && typeof value === "string") {
        // Validated here rather than at write time: an unparseable date stored
        // in the JSON would make every subsequent refresh throw.
        const parsed = parseIsoDate(value);
        if (!parsed) {
          return badRequest(
            set,
            "published_date must be an ISO date (YYYY-MM-DD)",
          );
        }
        patch[stored] = parsed.toISOString();
        continue;
      }

      if (stored === "language" && typeof value === "string") {
        /**
         * ISO 639-1, lowercase.
         *
         * bookGrabber appends this to preferredLanguages and compares it with
         * two-letter codes parsed from release titles, so "French" or "FR"
         * would quietly cost the book its own language preference in scoring.
         */
        const code = value.trim().toLowerCase();
        if (!/^[a-z]{2}$/.test(code)) {
          return badRequest(
            set,
            "language must be a two-letter ISO 639-1 code",
          );
        }
        patch[stored] = code;
        continue;
      }

      if (stored === "overview" && typeof value === "string") {
        // Operator input reaching the same column a provider writes, so it is
        // sanitized identically.
        const clean = sanitizeProviderHtml(value);
        if (!clean) {
          removed.push(stored);
          continue;
        }
        patch[stored] = clean;
        continue;
      }

      if (Array.isArray(value)) {
        const list = value.map((v) => String(v).trim()).filter(Boolean);
        if (list.length === 0) {
          removed.push(stored);
          continue;
        }
        patch[stored] = list;
        continue;
      }

      patch[stored] = typeof value === "string" ? value.trim() : value;
    }

    if (Object.keys(patch).length === 0 && removed.length === 0) {
      return badRequest(set, "No override fields supplied");
    }

    try {
      const item = await serializePerBook(id, async () => {
        /**
         * Merged in the database, not read-modify-written in the handler.
         *
         * Each field has its own Save button, so two saves can overlap.
         * Reading the JSON, merging in memory and writing it back would let
         * the second write drop the first field, since both started from the
         * same snapshot. `||` adds and replaces keys, `-` removes them, both
         * inside the one statement.
         */
        await prisma.$executeRaw`
          UPDATE library_books
          SET overrides =
            (COALESCE(overrides, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb)
            - ${removed}::text[]
          WHERE id = ${id}
        `;

        // Recompute so the columns reflect the change: an override has to win,
        // a cleared field has to fall back to the sources, and a cleared field
        // no source supplies has to be emptied rather than left frozen.
        await refreshBookMetadata(id, { clearedOverrides: removed });

        return prisma.libraryBook.findUnique({
          where: { id },
          include: bookInclude,
        });
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
      title: nullableStr(500),
      subtitle: nullableStr(500),
      series_name: nullableStr(300),
      // Float: half-books exist ("Book 4.5"), matching the column.
      series_position: t.Optional(
        t.Union([t.Number({ minimum: 0, maximum: 10_000 }), t.Null()]),
      ),
      narrators: t.Optional(t.Union([t.Array(t.String()), t.Null()])),
      genres: t.Optional(t.Union([t.Array(t.String()), t.Null()])),
      publisher: nullableStr(300),
      page_count: nullableInt(0, 100_000),
      published_date: nullableStr(40),
      published_year: nullableInt(0, 9999),
      rating: t.Optional(
        t.Union([t.Number({ minimum: 0, maximum: 5 }), t.Null()]),
      ),
      rating_count: nullableInt(0, 1_000_000_000),
      language: nullableStr(20),
      overview: nullableStr(20_000),
      cover_url: nullableStr(2000),
      isbn13: nullableStr(20),
    }),
  },
);
