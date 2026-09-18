import { Hono } from "hono";
import { z } from "zod";

import type { Env } from "@rawkoon/api/honoEnv";
import { requireUser } from "@rawkoon/api/middleware/hono/auth";
import { jsonV } from "@rawkoon/api/middleware/validate";
import { badRequest, ok, serviceUnavailable } from "@rawkoon/api/errors";
import {
  getConfiguredSources,
  getDiscovery,
} from "@rawkoon/api/services/books/bookDiscovery";
import { getDiscoverySource } from "@rawkoon/api/services/books/discoverySources";
import {
  addBookFromMetadata,
  addBookFromVolume,
} from "@rawkoon/api/services/books/bookLibrary";
import { BookProviderUnavailableError } from "@rawkoon/api/services/books";

const addBody = z.object({
  volume_id: z.string().nullish(),
  isbn13: z.string().nullish(),
  title: z.string(),
  author: z.string().nullish(),
  overview: z.string().nullish(),
  cover_url: z.string().nullish(),
  published_year: z.number().nullish(),
});

/**
 * Books Explore: ranked bestseller lists from pluggable sources. Guarded
 * per-route (not `.use("*")`) so the guard never leaks across the `.route()`
 * merge in the books router index.
 */
export const bookDiscoveryRoutes = new Hono<Env>()
  .get("/discovery/sources", requireUser, async (c) => {
    return ok(await getConfiguredSources());
  })
  .get("/discovery", requireUser, async (c) => {
    const source = c.req.query("source") || "leslibraires";
    const list = c.req.query("list") || "general";
    if (!getDiscoverySource(source)) {
      return badRequest("Unknown discovery source");
    }
    try {
      return ok(await getDiscovery(source, list));
    } catch (e) {
      if (e instanceof BookProviderUnavailableError) {
        return serviceUnavailable("Discovery source unavailable");
      }
      throw e;
    }
  })
  // Add a discovered book. When a Google volume matched it goes through the
  // provider path; otherwise it is created straight from the scraped metadata,
  // so a francophone-Québec title Google does not index is still addable.
  .post("/discovery/add", requireUser, jsonV(addBody), async (c) => {
    const b = c.req.valid("json");
    const outcome = b.volume_id
      ? await addBookFromVolume({
          volumeId: b.volume_id,
          isbn13: b.isbn13 ?? null,
          kinds: ["ebook"],
        })
      : b.isbn13
        ? await addBookFromMetadata({
            isbn13: b.isbn13,
            title: b.title,
            author: b.author ?? null,
            overview: b.overview ?? null,
            coverUrl: b.cover_url ?? null,
            publishedYear: b.published_year ?? null,
            kinds: ["ebook"],
          })
        : { added: false as const, reason: "isbn13 or volume_id is required" };

    if (!outcome.added) {
      if (outcome.unavailable) return serviceUnavailable(outcome.reason);
      return badRequest(outcome.reason);
    }
    return ok({ added: true, book_id: outcome.bookId });
  });
