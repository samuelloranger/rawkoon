import { Elysia } from "elysia";
import { auth } from "@rawkoon/api/auth";
import { requireAdmin } from "@rawkoon/api/middleware/auth";
import { adminJobRoutes } from "./adminJobRoutes";
import { adminLibraryHealthRoutes } from "./adminLibraryHealthRoutes";
import { adminUserRoutes } from "./adminUserRoutes";
import { adminMiscRoutes } from "./adminMiscRoutes";
import { adminApiKeyRoutes } from "./apiKeyRoutes";

export const adminRoutes = new Elysia({ prefix: "/api/admin" })
  .use(auth)
  .use(requireAdmin)
  .use(adminJobRoutes)
  .use(adminLibraryHealthRoutes)
  .use(adminUserRoutes)
  .use(adminApiKeyRoutes)
  .use(adminMiscRoutes);
