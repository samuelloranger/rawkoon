import { Hono } from "hono";
import { notFound } from "@rawkoon/api/errors";
import { type Env, honoOnError } from "@rawkoon/api/honoEnv";
import { requireAdmin } from "@rawkoon/api/middleware/hono/auth";
import { adminJobRoutes } from "./adminJobRoutes";
import { adminLibraryHealthRoutes } from "./adminLibraryHealthRoutes";
import { adminUserRoutes } from "./adminUserRoutes";
import { adminMiscRoutes } from "./adminMiscRoutes";
import { adminApiKeyRoutes } from "./apiKeyRoutes";

// Mounted at /api/admin by the edge. One
// requireAdmin guard here propagates to every merged child; onError keeps an
// uncaught throw a neutral 500 (some job routes throw).
export const adminRoutes = new Hono<Env>()
  .use("*", requireAdmin)
  .route("/", adminJobRoutes)
  .route("/", adminLibraryHealthRoutes)
  .route("/", adminUserRoutes)
  .route("/", adminApiKeyRoutes)
  .route("/", adminMiscRoutes)
  .notFound(() => notFound("Not found"))
  .onError(honoOnError);
