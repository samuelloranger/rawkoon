import { Elysia } from "elysia";
import { auth } from "@rawkoon/api/auth";

import { bookListRoutes } from "./bookListRoutes";
import { bookEditionRoutes } from "./bookEditionRoutes";
import { bookGrabRoutes } from "./bookGrabRoutes";

export { mapBook, mapBookEdition, bookInclude } from "./bookHelpers";
export { bookQualityProfileRoutes } from "./bookQualityProfileRoutes";
export { authorRoutes } from "./authorRoutes";

/**
 * Books router — thin orchestrator, same shape as routes/library/index.ts.
 *   bookListRoutes    — GET /, GET /search, GET /:id, POST /, DELETE /:id
 *   bookEditionRoutes — PATCH /:id/editions/:kind, POST /:id/editions, files
 *   bookGrabRoutes    — search / grab / auto per edition
 *
 * bookListRoutes must come first: its literal /search route has to be matched
 * before anything that could treat "search" as an :id.
 */
export const bookRoutes = new Elysia({ prefix: "/api/books" })
  .use(auth)
  .use(bookListRoutes)
  .use(bookEditionRoutes)
  .use(bookGrabRoutes);
