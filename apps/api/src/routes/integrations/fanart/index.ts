import { Hono } from "hono";
import { z } from "zod";
import { prisma } from "@rawkoon/api/db";
import {
  getIntegrationConfigRecord,
  invalidateIntegrationConfigCache,
} from "@rawkoon/api/services/integrationConfigCache";
import { nowUtc } from "@rawkoon/api/utils";
import { normalizeFanartConfig } from "@rawkoon/api/utils/integrations/normalizers";
import { encrypt } from "@rawkoon/api/services/crypto";
import { logActivity } from "@rawkoon/api/utils/activityLogs";
import { badRequest, ok, serverError } from "@rawkoon/api/errors";
import type { Env } from "@rawkoon/api/honoEnv";
import { jsonV } from "@rawkoon/api/middleware/validate";

// Mounted under /api/integrations; requireAdmin is applied at the parent.
export const fanartIntegrationRoutes = new Hono<Env>()
  .get("/fanart", async () => {
    try {
      const integration = await getIntegrationConfigRecord("fanart");
      const config = normalizeFanartConfig(integration?.config);

      return ok({
        integration: {
          type: "fanart",
          enabled: integration?.enabled || false,
          api_key: "",
          api_key_set: Boolean(config?.api_key),
        },
      });
    } catch (error) {
      console.error("Error fetching fanart integration config:", error);
      return serverError("Failed to fetch fanart integration config");
    }
  })
  .put(
    "/fanart",
    jsonV(
      z.object({
        api_key: z.string(),
        enabled: z.boolean().optional(),
      }),
    ),
    async (c) => {
      const body = c.req.valid("json");
      const existingIntegration = await getIntegrationConfigRecord("fanart");
      const existingConfig = normalizeFanartConfig(existingIntegration?.config);
      const providedApiKey = body.api_key.trim();
      // A blank key means "keep the stored one" so the toggle works alone.
      const apiKey = providedApiKey || existingConfig?.api_key || "";
      const enabled = body.enabled ?? true;

      if (!apiKey) {
        return badRequest("api_key is required");
      }

      try {
        const now = nowUtc();
        const configPayload = { api_key: encrypt(apiKey) };
        const integration = await prisma.integration.upsert({
          where: { type: "fanart" },
          update: { enabled, config: configPayload, updatedAt: now },
          create: {
            type: "fanart",
            enabled,
            config: configPayload,
            createdAt: now,
            updatedAt: now,
          },
        });
        await invalidateIntegrationConfigCache("fanart");

        await logActivity({
          type: "integration_updated",
          userId: c.get("user").id,
          payload: { integration_type: "fanart" },
        });

        return ok({
          success: true,
          integration: {
            type: integration.type,
            enabled: integration.enabled,
            api_key: "",
            api_key_set: true,
          },
        });
      } catch (error) {
        console.error("Error saving fanart integration config:", error);
        return serverError("Failed to save fanart integration config");
      }
    },
  );
