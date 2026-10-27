import { Hono } from "hono";
import { z } from "zod";
import { notFound, ok, serverError } from "@rawkoon/api/errors";
import { requireApiKey } from "@rawkoon/api/middleware/hono/apiKey";
import { queryV } from "@rawkoon/api/middleware/validate";
import { buildLibraryExport } from "@rawkoon/api/services/library/exportLibrary";

const libraryQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  // Files, episodes and grabs are uncapped per media, so the page size bounds the payload.
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

// Mounted at /api/export; read-only access for API-key service consumers.
// Offset pages are a best-effort snapshot: consumers re-sync rather than rely on page stability.
export const exportRoutes = new Hono()
  .use("*", requireApiKey)
  .get("/library", queryV(libraryQuery), async (c) => {
    const { page, limit } = c.req.valid("query");
    try {
      return ok(await buildLibraryExport(page, limit));
    } catch (error) {
      console.error("Error exporting library:", error);
      return serverError("Failed to export library");
    }
  })
  .notFound(() => notFound("Not found"));
