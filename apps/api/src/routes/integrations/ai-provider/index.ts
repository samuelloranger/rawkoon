import { Hono } from "hono";
import { z } from "zod";
import { prisma } from "@rawkoon/api/db";
import { nowUtc } from "@rawkoon/api/utils";
import { isValidHttpUrl } from "@rawkoon/api/utils/integrations/utils";
import { normalizeAiProviderConfig } from "@rawkoon/api/utils/integrations/normalizers";
import { logActivity } from "@rawkoon/api/utils/activityLogs";
import {
  badGateway,
  badRequest,
  notFound,
  ok,
  serverError,
} from "@rawkoon/api/errors";
import { encrypt } from "@rawkoon/api/services/crypto";
import type { Env } from "@rawkoon/api/honoEnv";
import { jsonV } from "@rawkoon/api/middleware/validate";
import {
  getIntegrationConfigRecord,
  invalidateIntegrationConfigCache,
} from "@rawkoon/api/services/integrationConfigCache";

// Mounted under /api/integrations; requireAdmin is applied at the parent.
export const aiProviderIntegrationRoutes = new Hono<Env>()
  .get("/ai-provider", async () => {
    try {
      const integration = await prisma.integration.findFirst({
        where: { type: "ai-provider" },
      });
      const config = normalizeAiProviderConfig(integration?.config);
      return ok({
        integration: {
          type: "ai-provider",
          enabled: integration?.enabled ?? false,
          base_url: config?.base_url ?? "",
          model: config?.model ?? "",
          has_api_key: Boolean(config?.api_key),
        },
      });
    } catch (error) {
      console.error("Error fetching AI Provider config:", error);
      return serverError("Failed to fetch AI Provider config");
    }
  })
  .put(
    "/ai-provider",
    jsonV(
      z.object({
        base_url: z.string(),
        model: z.string(),
        api_key: z.string().optional(),
        enabled: z.boolean().optional(),
      }),
    ),
    async (c) => {
      const body = c.req.valid("json");
      const baseUrl = body.base_url.trim().replace(/\/+$/, "");
      if (!baseUrl || !isValidHttpUrl(baseUrl)) {
        return badRequest("Invalid base_url. Must be a valid http(s) URL.");
      }
      if (!body.model.trim()) {
        return badRequest("model is required");
      }

      // An empty api_key means "keep whatever is stored", so the form can be
      // submitted without re-entering a secret it is never shown.
      const existing = normalizeAiProviderConfig(
        (await getIntegrationConfigRecord("ai-provider"))?.config,
      );
      const apiKey = body.api_key?.trim() || existing?.api_key || "";

      try {
        const now = nowUtc();
        const integration = await prisma.integration.upsert({
          where: { type: "ai-provider" },
          update: {
            enabled: body.enabled ?? true,
            config: {
              base_url: baseUrl,
              model: body.model.trim(),
              ...(apiKey ? { api_key: encrypt(apiKey) } : {}),
            },
            updatedAt: now,
          },
          create: {
            type: "ai-provider",
            enabled: body.enabled ?? true,
            config: {
              base_url: baseUrl,
              model: body.model.trim(),
              ...(apiKey ? { api_key: encrypt(apiKey) } : {}),
            },
            createdAt: now,
            updatedAt: now,
          },
        });

        invalidateIntegrationConfigCache("ai-provider");

        await logActivity({
          type: "integration_updated",
          userId: c.get("user").id,
          payload: { integration_type: "ai-provider" },
        });

        return ok({
          success: true,
          integration: {
            type: integration.type,
            enabled: integration.enabled,
            base_url: baseUrl,
            model: body.model.trim(),
            has_api_key: Boolean(apiKey),
          },
        });
      } catch (error) {
        console.error("Error saving AI Provider config:", error);
        return serverError("Failed to save AI Provider config");
      }
    },
  )
  .get("/ai-provider/test", async () => {
    try {
      const record = await getIntegrationConfigRecord("ai-provider");
      const config = normalizeAiProviderConfig(record?.config);
      if (!record?.enabled || !config) {
        return notFound("AI Provider integration not configured or disabled");
      }

      const res = await fetch(`${config.base_url}/v1/models`, {
        headers: {
          Accept: "application/json",
          ...(config.api_key
            ? { Authorization: `Bearer ${config.api_key}` }
            : {}),
        },
        signal: AbortSignal.timeout(5_000),
      }).catch(() => null);

      if (!res?.ok) {
        return badGateway("Could not connect to AI Provider server");
      }

      const data = (await res.json().catch(() => null)) as {
        data?: Array<{ id: string }>;
      } | null;

      const models = data?.data?.map((m) => m.id) ?? [];

      if (models.length === 0) {
        return badGateway(
          "Server reachable but no models are loaded. Make sure the model is pulled.",
        );
      }

      const model_available = models.includes(config.model);

      return ok({ success: true, models, model_available });
    } catch (error) {
      console.error("Error testing AI Provider connection:", error);
      return serverError("Failed to test AI Provider connection");
    }
  });
