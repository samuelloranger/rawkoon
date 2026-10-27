import { Hono } from "hono";
import { z } from "zod";
import {
  findIntegrationRow,
  upsertIntegrationRow,
} from "@rawkoon/api/services/integrations/integrationSettings";
import { syncActiveIndexerManager } from "@rawkoon/api/services/indexerManager/activeManagerSync";
import {
  isValidHttpUrl,
  normalizeUrl,
} from "@rawkoon/api/utils/integrations/utils";
import { normalizeProwlarrConfig } from "@rawkoon/api/utils/integrations/normalizers";
import { logActivity } from "@rawkoon/api/utils/activityLogs";
import { encrypt } from "@rawkoon/api/services/crypto";
import { badRequest, ok, serverError } from "@rawkoon/api/errors";
import type { Env } from "@rawkoon/api/honoEnv";
import { jsonV } from "@rawkoon/api/middleware/validate";
import { ProwlarrAdapter } from "@rawkoon/api/services/indexerManager/prowlarrAdapter";

// Mounted under /api/integrations; requireAdmin is applied at the parent.
export const prowlarrIntegrationRoutes = new Hono<Env>()
  .get("/prowlarr", async () => {
    try {
      const integration = await findIntegrationRow("prowlarr");

      const config = normalizeProwlarrConfig(integration?.config);
      return ok({
        integration: {
          type: "prowlarr",
          enabled: integration?.enabled || false,
          website_url: config?.website_url || "",
          api_key: "",
          rss_indexers: config?.rss_indexers ?? [],
        },
      });
    } catch (error) {
      console.error("Error fetching Prowlarr integration config:", error);
      return serverError("Failed to fetch Prowlarr integration config");
    }
  })
  .put(
    "/prowlarr",
    jsonV(
      z.object({
        website_url: z.string(),
        api_key: z.string(),
        enabled: z.boolean().optional(),
        rss_indexers: z.array(z.string().min(1)).optional(),
      }),
    ),
    async (c) => {
      const body = c.req.valid("json");
      const websiteUrl = normalizeUrl(body.website_url);
      const existingIntegration = await findIntegrationRow("prowlarr");
      const existingConfig = normalizeProwlarrConfig(
        existingIntegration?.config,
      );
      const providedApiKey = body.api_key.trim();
      const apiKey = providedApiKey || existingConfig?.api_key || "";
      const enabled = body.enabled ?? true;

      if (!websiteUrl || !isValidHttpUrl(websiteUrl)) {
        return badRequest("Invalid website_url. Must be a valid http(s) URL.");
      }

      if (!apiKey) {
        return badRequest("api_key is required");
      }

      try {
        const integration = await upsertIntegrationRow({
          type: "prowlarr",
          enabled,
          config: {
            website_url: websiteUrl,
            api_key: encrypt(apiKey),
          },
        });

        await syncActiveIndexerManager("prowlarr", enabled);

        await logActivity({
          type: "integration_updated",
          userId: c.get("user").id,
          payload: { integration_type: "prowlarr" },
        });

        return ok({
          success: true,
          integration: {
            type: integration.type,
            enabled: integration.enabled,
            website_url: websiteUrl,
            api_key: "",
          },
        });
      } catch (error) {
        console.error("Error saving Prowlarr integration config:", error);
        return serverError("Failed to save Prowlarr integration config");
      }
    },
  )
  .get("/prowlarr/indexers", async () => {
    try {
      const integration = await findIntegrationRow("prowlarr", {
        enabledOnly: true,
      });
      const config = normalizeProwlarrConfig(integration?.config);
      if (!config) return ok({ indexers: [] });
      const adapter = new ProwlarrAdapter(config);
      const indexers = await adapter.getIndexers();
      return ok({ indexers });
    } catch (error) {
      console.error("Error fetching Prowlarr indexers:", error);
      return serverError("Failed to fetch Prowlarr indexers");
    }
  });
