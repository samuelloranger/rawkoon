import { Elysia, t } from "elysia";
import { auth } from "@rawkoon/api/auth";
import { prisma } from "@rawkoon/api/db";
import { nowUtc } from "@rawkoon/api/utils";
import {
  isValidHttpUrl,
  normalizeUrl,
} from "@rawkoon/api/utils/integrations/utils";
import { normalizeJellyfinConfig } from "@rawkoon/api/utils/integrations/normalizers";
import { logActivity } from "@rawkoon/api/utils/activityLogs";
import { encrypt } from "@rawkoon/api/services/crypto";
import { invalidateIntegrationConfigCache } from "@rawkoon/api/services/integrationConfigCache";
import { requireAdmin } from "@rawkoon/api/middleware/auth";
import { badRequest, serverError } from "@rawkoon/api/errors";

export const jellyfinIntegrationRoutes = new Elysia()
  .use(auth)
  .use(requireAdmin)
  .get("/jellyfin", async ({ user: _user, set }) => {
    try {
      const integration = await prisma.integration.findFirst({
        where: { type: "jellyfin" },
      });

      const config = normalizeJellyfinConfig(integration?.config);
      return {
        integration: {
          type: "jellyfin",
          enabled: integration?.enabled || false,
          website_url: config?.website_url || "",
          api_key: "",
        },
      };
    } catch (error) {
      console.error("Error fetching Jellyfin integration config:", error);
      return serverError(set, "Failed to fetch Jellyfin integration config");
    }
  })
  .put(
    "/jellyfin",
    async ({ user, body, set }) => {
      const websiteUrl = normalizeUrl(body.website_url);
      const existingIntegration = await prisma.integration.findFirst({
        where: { type: "jellyfin" },
      });
      const existingConfig = normalizeJellyfinConfig(
        existingIntegration?.config,
      );
      const providedApiKey = body.api_key.trim();
      const apiKey = providedApiKey || existingConfig?.api_key || "";
      const enabled = body.enabled ?? true;

      if (!websiteUrl || !isValidHttpUrl(websiteUrl)) {
        return badRequest(
          set,
          "Invalid website_url. Must be a valid http(s) URL.",
        );
      }

      if (!apiKey) {
        return badRequest(set, "api_key is required");
      }

      try {
        const now = nowUtc();
        const integration = await prisma.integration.upsert({
          where: { type: "jellyfin" },
          update: {
            enabled,
            config: {
              website_url: websiteUrl,
              api_key: encrypt(apiKey),
            },
            updatedAt: now,
          },
          create: {
            type: "jellyfin",
            enabled,
            config: {
              website_url: websiteUrl,
              api_key: encrypt(apiKey),
            },
            createdAt: now,
            updatedAt: now,
          },
        });

        // Drop the 60s TTL cache so library-refresh reads the new URL/key immediately.
        await invalidateIntegrationConfigCache("jellyfin");

        await logActivity({
          type: "integration_updated",
          userId: user!.id,
          payload: { integration_type: "jellyfin" },
        });

        return {
          success: true,
          integration: {
            type: integration.type,
            enabled: integration.enabled,
            website_url: websiteUrl,
            api_key: "",
          },
        };
      } catch (error) {
        console.error("Error saving Jellyfin integration config:", error);
        return serverError(set, "Failed to save Jellyfin integration config");
      }
    },
    {
      body: t.Object({
        website_url: t.String(),
        api_key: t.String(),
        enabled: t.Optional(t.Boolean()),
      }),
    },
  );
