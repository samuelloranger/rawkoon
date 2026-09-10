import { Hono } from "hono";

import {
  badRequest,
  forbidden,
  ok,
  serverError,
  unauthorized,
} from "@rawkoon/api/errors";
import type { Env } from "@rawkoon/api/honoEnv";
import { resolveUser } from "@rawkoon/api/middleware/auth";
import {
  listOpenLibraryAttentionForApi,
  dismissLibraryAttentionAlert,
} from "@rawkoon/api/services/libraryAttentionApi";

/**
 * GET /api/library/attention
 * PATCH /api/library/attention/:alertId/dismiss
 *
 * Self-guards via an inline resolveUser + admin check (401/403); effectively
 * admin-only, so no separate route-level guard is added.
 */
export const libraryAttentionRoutes = new Hono<Env>()
  .get("/attention", async (c) => {
    const u = await resolveUser(c.req.raw);
    if (!u) return unauthorized();
    if (!u.is_admin) return forbidden();
    try {
      return ok(await listOpenLibraryAttentionForApi());
    } catch (error) {
      console.error("[library/attention]", error);
      return serverError("Failed to fetch library attention");
    }
  })

  .patch("/attention/:alertId/dismiss", async (c) => {
    const u = await resolveUser(c.req.raw);
    if (!u) return unauthorized();
    if (!u.is_admin) return forbidden();
    try {
      const alertId = parseInt(c.req.param("alertId"), 10);
      if (!Number.isFinite(alertId)) return badRequest("Invalid alert id");
      const dismissed = await dismissLibraryAttentionAlert(alertId);
      if (!dismissed) return badRequest("Alert not found or not open");
      return ok({ success: true });
    } catch (error) {
      console.error("[library/attention/dismiss]", error);
      return serverError("Failed to dismiss alert");
    }
  });
