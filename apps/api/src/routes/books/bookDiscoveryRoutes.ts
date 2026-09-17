import { Hono } from "hono";

import type { Env } from "@rawkoon/api/honoEnv";
import { requireUser } from "@rawkoon/api/middleware/hono/auth";
import { badRequest, ok, serviceUnavailable } from "@rawkoon/api/errors";
import {
  getConfiguredSources,
  getDiscovery,
} from "@rawkoon/api/services/books/bookDiscovery";
import { getDiscoverySource } from "@rawkoon/api/services/books/discoverySources";
import { BookProviderUnavailableError } from "@rawkoon/api/services/books";

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
  });
