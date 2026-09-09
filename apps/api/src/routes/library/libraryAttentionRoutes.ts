import { Elysia } from "elysia";
import { z } from "zod";

import { resolveUser } from "@rawkoon/api/middleware/auth";
import { badRequest, serverError } from "@rawkoon/api/errors";
import {
  listOpenLibraryAttentionForApi,
  dismissLibraryAttentionAlert,
} from "@rawkoon/api/services/libraryAttentionApi";

/**
 * GET /api/library/attention
 * PATCH /api/library/attention/:alertId/dismiss
 */
export const libraryAttentionRoutes = new Elysia()
  .get("/attention", async ({ request, set }) => {
    const u = await resolveUser(request);
    if (!u) return (set.status = 401), { error: "Unauthorized" };
    if (!u.is_admin) return (set.status = 403), { error: "Forbidden" };
    try {
      return await listOpenLibraryAttentionForApi();
    } catch (error) {
      console.error("[library/attention]", error);
      return serverError("Failed to fetch library attention");
    }
  })

  .patch(
    "/attention/:alertId/dismiss",
    async ({ request, params, set }) => {
      const u = await resolveUser(request);
      if (!u) return (set.status = 401), { error: "Unauthorized" };
      if (!u.is_admin) return (set.status = 403), { error: "Forbidden" };
      try {
        const alertId = parseInt(params.alertId, 10);
        if (!Number.isFinite(alertId)) return badRequest("Invalid alert id");
        const ok = await dismissLibraryAttentionAlert(alertId);
        if (!ok) return badRequest("Alert not found or not open");
        return { success: true };
      } catch (error) {
        console.error("[library/attention/dismiss]", error);
        return serverError("Failed to dismiss alert");
      }
    },
    {
      params: z.object({ alertId: z.string() }),
    },
  );
