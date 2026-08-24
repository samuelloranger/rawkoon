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
      const { item, unrestored } = await serializePerBook(id, async () => {
        /**
         * Read inside the job, not before it.
         *
         * Captured outside the queue, this snapshot could predate another
         * request that has already been applied — a revert would then restore a
         * value that is no longer the one it is reverting.
         */
        const before = await prisma.libraryBook.findUnique({
          where: { id },
          select: { overrides: true },
        });
        const priorOverrides =
          before?.overrides &&
          typeof before.overrides === "object" &&
          !Array.isArray(before.overrides)
            ? (before.overrides as Record<string, unknown>)
            : {};

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
        let outcome;
        try {
          outcome = await refreshBookMetadata(id, {
            clearedOverrides: removed,
          });
        } catch (error) {
          /**
           * The JSON is already committed at this point, so a failed refresh
           * would otherwise leave the override stored while the column still
           * shows the old value — a request reported as failed that changed
           * something anyway. Put the previous state back before rethrowing.
           */
          await prisma.libraryBook.update({
            where: { id },
            data: { overrides: priorOverrides as object },
          });
          throw error;
        }

        /**
         * A revert the sources cannot honour is undone rather than half-applied.
         *
         * title and language cannot be emptied, so if nothing replaced them the
         * column still holds the operator's value. Leaving the override deleted
         * would strand it: displayed as if it came from a source, with no Revert
         * action and no later refresh able to repair it. Putting the override
         * back keeps the JSON and the column agreeing, and the caller is told.
         */
        const unrestored = outcome.ok ? outcome.unrestoredFields : [];
        if (unrestored.length > 0) {
          const restore: Record<string, unknown> = {};
          for (const field of unrestored) {
            if (Object.hasOwn(priorOverrides, field)) {
              restore[field] = priorOverrides[field];
            }
          }
          if (Object.keys(restore).length > 0) {
            await prisma.$executeRaw`
              UPDATE library_books
              SET overrides =
                COALESCE(overrides, '{}'::jsonb) || ${JSON.stringify(restore)}::jsonb
              WHERE id = ${id}
            `;
          }
        }

        const item = await prisma.libraryBook.findUnique({
          where: { id },
          include: bookInclude,
        });
        return { item, unrestored };
      });

      if (!item) return notFound(set, "Book not found");
      if (unrestored.length > 0) {
        return badRequest(
          set,
          `No metadata source supplies ${unrestored.join(", ")}, so it cannot be reverted. Your value was kept.`,
        );
      }
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
