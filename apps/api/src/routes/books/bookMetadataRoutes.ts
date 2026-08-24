import { Elysia, t } from "elysia";

import { requireAdmin, requireUser } from "@rawkoon/api/middleware/auth";
import { prisma } from "@rawkoon/api/db";
import { badRequest, notFound } from "@rawkoon/api/errors";
import { normalizeSourceOrder } from "@rawkoon/shared/utils";
import { refreshBookMetadata } from "@rawkoon/api/services/books/refreshBookMetadata";
import { serializePerBook } from "@rawkoon/api/services/books/refreshQueue";

/**
 * Metadata routes.
 *
 *   POST /api/books/:id/refresh-metadata  — re-run the source chain for a book
 *   GET  /api/books/metadata-sources      — the configured priority order
 *   PUT  /api/books/metadata-sources      — reorder it (admin)
 *
 * There is no scheduled sweep, so the refresh route is the only way metadata
 * changes after a book is added. A source that failed is reported back rather
 * than retried silently, which is what makes an outage legible instead of
 * looking like "this book has no narrators".
 */
export const bookMetadataRoutes = new Elysia()
  .use(requireUser)

  /**
   * Declared before the :id route below, because "metadata-sources" would
   * otherwise be matched as an :id. bookListRoutes relies on the same ordering
   * for its literal /search route.
   */
  .get("/metadata-sources", async () => {
    const settings = await prisma.mediaSettings.findUnique({
      where: { id: 1 },
      select: { bookMetadataSourceOrder: true },
    });
    return { order: normalizeSourceOrder(settings?.bookMetadataSourceOrder) };
  })

  .post(
    "/:id/refresh-metadata",
    async ({ params, set }) => {
      const id = Number(params.id);
      if (!Number.isInteger(id) || id <= 0)
        return badRequest(set, "Invalid book id");

      // Queued alongside override saves: an unqueued refresh could read the
      // old overrides, finish last, and overwrite the columns with a stale
      // snapshot — the disagreement the queue exists to prevent.
      const outcome = await serializePerBook(id, () => refreshBookMetadata(id));
      if (!outcome.ok) return notFound(set, outcome.reason);

      return {
        book_id: outcome.bookId,
        changed_fields: outcome.changedFields,
        failed_sources: outcome.failedSources,
        used_sources: outcome.usedSources,
      };
    },
    { params: t.Object({ id: t.String() }) },
  );

/**
 * Reordering is admin-only and lives in its own instance so `requireAdmin`
 * does not apply to the read route above.
 */
export const bookMetadataAdminRoutes = new Elysia().use(requireAdmin).put(
  "/metadata-sources",
  async ({ body }) => {
    // Absence from the array is the disable switch, so an unusable array falls
    // back to the default order rather than disabling every source.
    const order = normalizeSourceOrder(body.order);
    await prisma.mediaSettings.update({
      where: { id: 1 },
      data: { bookMetadataSourceOrder: order },
    });
    return { order };
  },
  { body: t.Object({ order: t.Array(t.String()) }) },
);
