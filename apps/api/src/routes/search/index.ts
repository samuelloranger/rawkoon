import { Hono } from "hono";
import { z } from "zod";
import { notFound, ok, serverError } from "@rawkoon/api/errors";
import type { Env } from "@rawkoon/api/honoEnv";
import { requireUser } from "@rawkoon/api/middleware/hono/auth";
import { queryV } from "@rawkoon/api/middleware/validate";
import {
  searchLibraryBooks,
  searchLibraryMedias,
  searchUsers,
} from "@rawkoon/api/services/medias/quickSearch";

const quickQuery = z.object({
  q: z.string().optional(),
  limit: z.string().optional(),
});

// Mounted at /api/search by the edge.
export const searchRoutes = new Hono<Env>()
  .use("*", requireUser)
  .get("/quick", queryV(quickQuery), async (c) => {
    const query = c.req.valid("query");
    const user = c.get("user");
    try {
      const q = (query.q ?? "").trim().toLowerCase();
      const limit = Math.min(parseInt(query.limit || "6", 10) || 6, 20);

      const empty = { medias: [], books: [], users: [] };
      if (!q || q.length < 2) {
        return ok(empty);
      }

      const users = await searchUsers(q, limit, !!user.is_admin);

      let medias: Awaited<ReturnType<typeof searchLibraryMedias>> = [];
      try {
        medias = await searchLibraryMedias(q, limit);
      } catch {
        // library table not yet available — return empty
      }

      // Books are gated: a movies-only install must not pay for the query and
      // must not see a section it has no pages for.
      let books: Awaited<ReturnType<typeof searchLibraryBooks>> = [];
      try {
        books = await searchLibraryBooks(q, limit);
      } catch {
        // book tables not yet migrated — return empty
      }

      return ok({
        medias,
        books,
        users: users.map((u) => ({
          id: u.id,
          name: u.firstName
            ? `${u.firstName}${u.lastName ? ` ${u.lastName}` : ""}`
            : user.is_admin
              ? u.email
              : "User",
          ...(user.is_admin ? { email: u.email } : {}),
        })),
      });
    } catch (error) {
      console.error("Error in quick search:", error);
      return serverError("Search failed");
    }
  })
  .notFound(() => notFound("Not found"));
