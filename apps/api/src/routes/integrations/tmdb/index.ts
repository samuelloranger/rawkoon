import { Elysia, t } from "elysia";
import { auth } from "@rawkoon/api/auth";
import { prisma } from "@rawkoon/api/db";
import {
  getIntegrationConfigRecord,
  invalidateIntegrationConfigCache,
} from "@rawkoon/api/services/integrationConfigCache";
import { nowUtc } from "@rawkoon/api/utils";
import { normalizeTmdbConfig } from "@rawkoon/api/utils/integrations/normalizers";
import { encrypt } from "@rawkoon/api/services/crypto";
import { logActivity } from "@rawkoon/api/utils/activityLogs";
import { requireAdmin } from "@rawkoon/api/middleware/auth";
import { badRequest, serverError } from "@rawkoon/api/errors";

export const tmdbIntegrationRoutes = new Elysia()
  .use(auth)
  .use(requireAdmin)
  .get("/tmdb", async ({ user: _user, set }) => {
    try {
      const integration = await getIntegrationConfigRecord("tmdb");
      const config = normalizeTmdbConfig(integration?.config);

      return {
        integration: {
          type: "tmdb",
          enabled: integration?.enabled || false,
          api_key: "",
          popularity_threshold: config?.popularity_threshold ?? 15,
        },
      };
    } catch (error) {
      console.error("Error fetching TMDB integration config:", error);
      return serverError(set, "Failed to fetch TMDB integration config");
    }
  })
  .put(
    "/tmdb",
    async ({ user, body, set }) => {
      const existingIntegration = await getIntegrationConfigRecord("tmdb");
      const existingConfig = normalizeTmdbConfig(existingIntegration?.config);
      const providedApiKey = body.api_key.trim();
      const apiKey = providedApiKey || existingConfig?.api_key || "";
      const enabled = body.enabled ?? true;
      const popularityThreshold = Math.max(
        0,
        Math.min(100, Math.round(body.popularity_threshold ?? 15)),
      );

      if (!apiKey) {
        return badRequest(set, "api_key is required");
      }

      try {
        const now = nowUtc();
        const configPayload = {
          api_key: encrypt(apiKey),
          popularity_threshold: popularityThreshold,
        };
        const integration = await prisma.integration.upsert({
          where: { type: "tmdb" },
          update: {
            enabled,
            config: configPayload,
            updatedAt: now,
          },
          create: {
            type: "tmdb",
            enabled,
            config: configPayload,
            createdAt: now,
            updatedAt: now,
          },
        });
        await invalidateIntegrationConfigCache("tmdb");

        await logActivity({
          type: "integration_updated",
          userId: user!.id,
          payload: { integration_type: "tmdb" },
        });

        return {
          success: true,
          integration: {
            type: integration.type,
            enabled: integration.enabled,
            api_key: "",
            popularity_threshold: popularityThreshold,
          },
        };
      } catch (error) {
        console.error("Error saving TMDB integration config:", error);
        return serverError(set, "Failed to save TMDB integration config");
      }
    },
    {
      body: t.Object({
        api_key: t.String(),
        enabled: t.Optional(t.Boolean()),
        popularity_threshold: t.Optional(t.Number()),
      }),
    },
  );
