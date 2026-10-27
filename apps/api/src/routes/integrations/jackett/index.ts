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
import { normalizeJackettConfig } from "@rawkoon/api/utils/integrations/normalizers";
import { logActivity } from "@rawkoon/api/utils/activityLogs";
import { encrypt } from "@rawkoon/api/services/crypto";
import { badRequest, ok, serverError } from "@rawkoon/api/errors";
import type { Env } from "@rawkoon/api/honoEnv";
import { jsonV } from "@rawkoon/api/middleware/validate";
import { JackettAdapter } from "@rawkoon/api/services/indexerManager/jackettAdapter";

// Mounted under /api/integrations; requireAdmin is applied at the parent.
export const jackettIntegrationRoutes = new Hono<Env>()
  .get("/jackett", async () => {
    try {
      const integration = await findIntegrationRow("jackett");

      const config = normalizeJackettConfig(integration?.config);
      return ok({
        integration: {
          type: "jackett",
          enabled: integration?.enabled || false,
          website_url: config?.website_url || "",
          api_key: "",
          rss_indexers: config?.rss_indexers ?? [],
        },
      });
    } catch (error) {
      console.error("Error fetching Jackett integration config:", error);
      return serverError("Failed to fetch Jackett integration config");
    }
  })
  .put(
    "/jackett",
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
      const existingIntegration = await findIntegrationRow("jackett");
      const existingConfig = normalizeJackettConfig(
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
        const rssIndexers = Array.isArray(body.rss_indexers)
          ? body.rss_indexers
          : (existingConfig?.rss_indexers ?? []);

        const integration = await upsertIntegrationRow({
          type: "jackett",
          enabled,
          config: {
            website_url: websiteUrl,
            api_key: encrypt(apiKey),
            rss_indexers: rssIndexers,
          },
        });

        await syncActiveIndexerManager("jackett", enabled);

        await logActivity({
          type: "integration_updated",
          userId: c.get("user").id,
          payload: { integration_type: "jackett" },
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
        console.error("Error saving Jackett integration config:", error);
        return serverError("Failed to save Jackett integration config");
      }
    },
  )
  .get("/jackett/indexers", async () => {
    try {
      const integration = await findIntegrationRow("jackett", {
        enabledOnly: true,
      });
      const config = normalizeJackettConfig(integration?.config);
      if (!config) return ok({ indexers: [] });
      const adapter = new JackettAdapter(config);
      const indexers = await adapter.getIndexers();
      return ok({ indexers });
    } catch (error) {
      console.error("Error fetching Jackett indexers:", error);
      return serverError("Failed to fetch Jackett indexers");
    }
  });
