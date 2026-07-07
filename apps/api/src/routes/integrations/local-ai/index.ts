import { Elysia, t } from "elysia";
import { auth } from "@rawkoon/api/auth";
import { prisma } from "@rawkoon/api/db";
import { nowUtc } from "@rawkoon/api/utils";
import { isValidHttpUrl } from "@rawkoon/api/utils/integrations/utils";
import { normalizeLocalAiConfig } from "@rawkoon/api/utils/integrations/normalizers";
import { logActivity } from "@rawkoon/api/utils/activityLogs";
import { requireAdmin } from "@rawkoon/api/middleware/auth";
import { badRequest, serverError } from "@rawkoon/api/errors";
import {
  getIntegrationConfigRecord,
  invalidateIntegrationConfigCache,
} from "@rawkoon/api/services/integrationConfigCache";

export const localAiIntegrationRoutes = new Elysia()
  .use(auth)
  .use(requireAdmin)
  .get("/local-ai", async ({ set }) => {
    try {
      const integration = await prisma.integration.findFirst({
        where: { type: "local-ai" },
      });
      const config = normalizeLocalAiConfig(integration?.config);
      return {
        integration: {
          type: "local-ai",
          enabled: integration?.enabled ?? false,
          base_url: config?.base_url ?? "",
          model: config?.model ?? "",
        },
      };
    } catch (error) {
      console.error("Error fetching Local AI config:", error);
      return serverError(set, "Failed to fetch Local AI config");
    }
  })
  .put(
    "/local-ai",
    async ({ user, body, set }) => {
      const baseUrl = body.base_url.trim().replace(/\/+$/, "");
      if (!baseUrl || !isValidHttpUrl(baseUrl)) {
        return badRequest(
          set,
          "Invalid base_url. Must be a valid http(s) URL.",
        );
      }
      if (!body.model.trim()) {
        return badRequest(set, "model is required");
      }

      try {
        const now = nowUtc();
        const integration = await prisma.integration.upsert({
          where: { type: "local-ai" },
          update: {
            enabled: body.enabled ?? true,
            config: { base_url: baseUrl, model: body.model.trim() },
            updatedAt: now,
          },
          create: {
            type: "local-ai",
            enabled: body.enabled ?? true,
            config: { base_url: baseUrl, model: body.model.trim() },
            createdAt: now,
            updatedAt: now,
          },
        });

        invalidateIntegrationConfigCache("local-ai");

        await logActivity({
          type: "integration_updated",
          userId: user!.id,
          payload: { integration_type: "local-ai" },
        });

        return {
          success: true,
          integration: {
            type: integration.type,
            enabled: integration.enabled,
            base_url: baseUrl,
            model: body.model.trim(),
          },
        };
      } catch (error) {
        console.error("Error saving Local AI config:", error);
        return serverError(set, "Failed to save Local AI config");
      }
    },
    {
      body: t.Object({
        base_url: t.String(),
        model: t.String(),
        enabled: t.Optional(t.Boolean()),
      }),
    },
  )
  .get("/local-ai/test", async ({ set }) => {
    try {
      const record = await getIntegrationConfigRecord("local-ai");
      const config = normalizeLocalAiConfig(record?.config);
      if (!record?.enabled || !config) {
        set.status = 404;
        return { error: "Local AI integration not configured or disabled" };
      }

      const res = await fetch(`${config.base_url}/v1/models`, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(5_000),
      }).catch(() => null);

      if (!res?.ok) {
        set.status = 502;
        return { error: "Could not connect to Local AI server" };
      }

      const data = (await res.json().catch(() => null)) as {
        data?: Array<{ id: string }>;
      } | null;

      const models = data?.data?.map((m) => m.id) ?? [];

      if (models.length === 0) {
        set.status = 502;
        return {
          error:
            "Server reachable but no models are loaded. Make sure the model is pulled.",
        };
      }

      const model_available = models.includes(config.model);

      return { success: true, models, model_available };
    } catch (error) {
      console.error("Error testing Local AI connection:", error);
      return serverError(set, "Failed to test Local AI connection");
    }
  });
