import { Hono } from "hono";
import { z } from "zod";

import type { Env } from "@rawkoon/api/honoEnv";
import { requireAdmin } from "@rawkoon/api/middleware/hono/auth";
import { jsonV } from "@rawkoon/api/middleware/validate";
import { badRequest, notFound, ok, serverError } from "@rawkoon/api/errors";
import { sanitizeProviderHtml } from "@rawkoon/shared/utils";
import {
  applyBookOverrides,
  bookIdExists,
  loadReadAtForBook,
} from "@rawkoon/api/services/books/bookOverridesApply";
import { parseIsoDate } from "@rawkoon/api/utils/books/isoDate";

import { mapBook } from "./bookHelpers";

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
  z.union([z.string().max(max), z.null()]).optional();

/**
 * Integer columns must reject fractions at the edge.
 *
 * The override JSON is written before the merge converts it into a column, so
 * a value Postgres cannot store would persist in the JSON and make every later
 * refresh of that book fail — the bad value would outlive the request that
 * introduced it.
 */
const nullableInt = (min: number, max: number) =>
  z.union([z.number().int().min(min).max(max), z.null()]).optional();

export const bookOverridesRoutes = new Hono<Env>().patch(
  "/:id/overrides",
  requireAdmin,
  jsonV(
    z.object({
      title: nullableStr(500),
      subtitle: nullableStr(500),
      series_name: nullableStr(300),
      // Float: half-books exist ("Book 4.5"), matching the column.
      series_position: z
        .union([z.number().min(0).max(10_000), z.null()])
        .optional(),
      narrators: z.union([z.array(z.string()), z.null()]).optional(),
      genres: z.union([z.array(z.string()), z.null()]).optional(),
      publisher: nullableStr(300),
      page_count: nullableInt(0, 100_000),
      published_date: nullableStr(40),
      published_year: nullableInt(0, 9999),
      rating: z.union([z.number().min(0).max(5), z.null()]).optional(),
      rating_count: nullableInt(0, 1_000_000_000),
      language: nullableStr(20),
      overview: nullableStr(20_000),
      cover_url: nullableStr(2000),
      isbn13: nullableStr(20),
    }),
  ),
  async (c) => {
    const body = c.req.valid("json");
    const user = c.get("user");
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0) return badRequest("Invalid book id");

    if (!(await bookIdExists(id))) return notFound("Book not found");

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
          return badRequest("published_date must be an ISO date (YYYY-MM-DD)");
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
          return badRequest("language must be a two-letter ISO 639-1 code");
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
      return badRequest("No override fields supplied");
    }

    try {
      const { item, unrestored } = await applyBookOverrides(id, patch, removed);

      if (!item) return notFound("Book not found");
      if (unrestored.length > 0) {
        return badRequest(
          `No metadata source supplies ${unrestored.join(", ")}, so it cannot be reverted. Your value was kept.`,
        );
      }
      const readAt = await loadReadAtForBook(user.id, item.id);
      return ok({ item: mapBook(item, { readAt }) });
    } catch (error) {
      console.error("Failed to update book overrides:", error);
      return serverError("Failed to update overrides");
    }
  },
);
