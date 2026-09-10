import { Hono } from "hono";
import { z } from "zod";

import type { Env } from "@rawkoon/api/honoEnv";
import { requireAdmin, requireUser } from "@rawkoon/api/middleware/hono/auth";
import { jsonV } from "@rawkoon/api/middleware/validate";
import { prisma } from "@rawkoon/api/db";
import { badRequest, notFound, ok } from "@rawkoon/api/errors";
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
export const bookMetadataRoutes = new Hono<Env>()
  /**
   * Declared before the :id route below, because "metadata-sources" would
   * otherwise be matched as an :id. bookListRoutes relies on the same ordering
   * for its literal /search route.
   */
  .get("/metadata-sources", requireUser, async () => {
    const settings = await prisma.mediaSettings.findUnique({
      where: { id: 1 },
      select: { bookMetadataSourceOrder: true },
    });
    return ok({
      order: normalizeSourceOrder(settings?.bookMetadataSourceOrder),
    });
  })

  .post("/:id/refresh-metadata", requireUser, async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0) return badRequest("Invalid book id");

    // Queued alongside override saves: an unqueued refresh could read the
    // old overrides, finish last, and overwrite the columns with a stale
    // snapshot — the disagreement the queue exists to prevent.
    const outcome = await serializePerBook(id, () => refreshBookMetadata(id));
    if (!outcome.ok) return notFound(outcome.reason);

    return ok({
      book_id: outcome.bookId,
      changed_fields: outcome.changedFields,
      failed_sources: outcome.failedSources,
      used_sources: outcome.usedSources,
    });
  });

/**
 * Reordering is admin-only and lives in its own instance so `requireAdmin`
 * does not apply to the read route above.
 */
export const bookMetadataAdminRoutes = new Hono<Env>().put(
  "/metadata-sources",
  requireAdmin,
  jsonV(z.object({ order: z.array(z.string()) })),
  async (c) => {
    // Absence from the array is the disable switch, so an unusable array falls
    // back to the default order rather than disabling every source.
    const order = normalizeSourceOrder(c.req.valid("json").order);
    await prisma.mediaSettings.update({
      where: { id: 1 },
      data: { bookMetadataSourceOrder: order },
    });
    return ok({ order });
  },
);
