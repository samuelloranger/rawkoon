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
import { jsonV, queryV } from "@rawkoon/api/middleware/validate";
import { requireAdmin } from "@rawkoon/api/middleware/hono/auth";
import {
  getAiStats,
  listAiCalls,
  type AiPrices,
} from "@rawkoon/api/services/aiProvider/usageStats";
import {
  AI_CALL_STATUSES,
  AI_FEATURES,
  AI_STATS_PERIODS,
  type AiFeature,
} from "@rawkoon/shared/types";
import { invalidateAiSpendCache } from "@rawkoon/api/services/aiProvider/aiGate";
import {
  getIntegrationConfigRecord,
  invalidateIntegrationConfigCache,
} from "@rawkoon/api/services/integrationConfigCache";

// Blank means "no price"; coerce alone would turn "" and null into 0.
const priceField = z.preprocess(
  (v) => (v === "" || v === null ? undefined : v),
  z.coerce.number().min(0).finite().optional(),
);

const statsQuery = z.object({
  days: z.coerce
    .number()
    .refine((d) => (AI_STATS_PERIODS as readonly number[]).includes(d), {
      message: "days must be one of 7, 30, 90, 365",
    })
    .default(30),
});

const callsQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(25),
  feature: z.string().min(1).optional(),
  status: z.enum(AI_CALL_STATUSES).optional(),
});

// Blank clears, absent keeps; coerce alone would turn "" and null into 0.
const budgetField = z.preprocess(
  (v) => (v === "" ? null : v),
  z.coerce.number().min(0).finite().nullable().optional(),
);

const featureToggles = z
  .object(
    Object.fromEntries(
      AI_FEATURES.map((f) => [f, z.boolean().optional()]),
    ) as Record<AiFeature, z.ZodOptional<z.ZodBoolean>>,
  )
  .optional();

async function loadAiConfig() {
  return normalizeAiProviderConfig(
    (await getIntegrationConfigRecord("ai-provider"))?.config,
  );
}

const pricesOf = (
  config: Awaited<ReturnType<typeof loadAiConfig>>,
): AiPrices => ({
  input: config?.input_price_per_million,
  output: config?.output_price_per_million,
});

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
          input_price_per_million: config?.input_price_per_million ?? null,
          output_price_per_million: config?.output_price_per_million ?? null,
          daily_budget_usd: config?.daily_budget_usd ?? null,
          features: config?.features ?? {},
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
        input_price_per_million: priceField,
        output_price_per_million: priceField,
        daily_budget_usd: budgetField,
        features: featureToggles,
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
      const existing = await loadAiConfig();
      const apiKey = body.api_key?.trim() || existing?.api_key || "";
      const inputPrice = body.input_price_per_million ?? null;
      const outputPrice = body.output_price_per_million ?? null;
      // Budget and features are kept when the body omits them (older clients
      // never send them) and cleared only by an explicit null.
      const budget =
        body.daily_budget_usd === undefined
          ? (existing?.daily_budget_usd ?? null)
          : body.daily_budget_usd;
      const features = body.features ?? existing?.features ?? {};
      const providerConfig = {
        base_url: baseUrl,
        model: body.model.trim(),
        ...(apiKey ? { api_key: encrypt(apiKey) } : {}),
        ...(inputPrice !== null ? { input_price_per_million: inputPrice } : {}),
        ...(outputPrice !== null
          ? { output_price_per_million: outputPrice }
          : {}),
        ...(budget !== null ? { daily_budget_usd: budget } : {}),
        ...(Object.keys(features).length > 0 ? { features } : {}),
      };

      try {
        const now = nowUtc();
        const integration = await prisma.integration.upsert({
          where: { type: "ai-provider" },
          update: {
            enabled: body.enabled ?? true,
            config: providerConfig,
            updatedAt: now,
          },
          create: {
            type: "ai-provider",
            enabled: body.enabled ?? true,
            config: providerConfig,
            createdAt: now,
            updatedAt: now,
          },
        });

        invalidateIntegrationConfigCache("ai-provider");
        invalidateAiSpendCache();

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
            input_price_per_million: inputPrice,
            output_price_per_million: outputPrice,
            daily_budget_usd: budget,
            features,
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
  })
  .get("/ai-provider/stats", requireAdmin, queryV(statsQuery), async (c) => {
    try {
      const { days } = c.req.valid("query");
      const config = await loadAiConfig();
      return ok(
        await getAiStats(
          days,
          pricesOf(config),
          new Date(),
          config?.daily_budget_usd ?? null,
        ),
      );
    } catch (error) {
      console.error("Error fetching AI usage stats:", error);
      return serverError("Failed to fetch AI usage stats");
    }
  })
  .get("/ai-provider/calls", requireAdmin, queryV(callsQuery), async (c) => {
    try {
      const q = c.req.valid("query");
      return ok(
        await listAiCalls({
          page: q.page,
          pageSize: q.page_size,
          feature: q.feature,
          status: q.status,
          prices: pricesOf(await loadAiConfig()),
        }),
      );
    } catch (error) {
      console.error("Error fetching AI call history:", error);
      return serverError("Failed to fetch AI call history");
    }
  });
