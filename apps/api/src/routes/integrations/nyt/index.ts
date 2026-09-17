import { Hono } from "hono";
import { z } from "zod";
import { prisma } from "@rawkoon/api/db";
import {
  getIntegrationConfigRecord,
  invalidateIntegrationConfigCache,
} from "@rawkoon/api/services/integrationConfigCache";
import { nowUtc } from "@rawkoon/api/utils";
import { normalizeNytBooksConfig } from "@rawkoon/api/utils/integrations/normalizers";
import { encrypt } from "@rawkoon/api/services/crypto";
import { logActivity } from "@rawkoon/api/utils/activityLogs";
import { badRequest, ok, serverError } from "@rawkoon/api/errors";
import type { Env } from "@rawkoon/api/honoEnv";
import { jsonV } from "@rawkoon/api/middleware/validate";

/**
 * NYT Books integration (bestseller discovery source).
 *
 * Mirrors the Google Books routes: the stored key is never returned, and an
 * empty `api_key` on save means "keep the existing one" so the form submits
 * without retyping a secret. The key is encrypted with the instance SECRET_KEY.
 */

const TEST_URL = "https://api.nytimes.com/svc/books/v3/lists/names.json";

// Mounted under /api/integrations; requireAdmin is applied at the parent.
export const nytBooksIntegrationRoutes = new Hono<Env>()
  .get("/nyt", async () => {
    try {
      const integration = await getIntegrationConfigRecord("nyt");
      const config = normalizeNytBooksConfig(integration?.config);
      return ok({
        integration: {
          type: "nyt",
          enabled: integration?.enabled ?? false,
          api_key: "",
          has_api_key: Boolean(config?.api_key),
        },
      });
    } catch (error) {
      console.error("Error fetching NYT Books integration config:", error);
      return serverError("Failed to fetch NYT Books integration config");
    }
  })

  .put(
    "/nyt",
    jsonV(z.object({ api_key: z.string(), enabled: z.boolean().optional() })),
    async (c) => {
      const body = c.req.valid("json");
      const existing = await getIntegrationConfigRecord("nyt");
      const existingConfig = normalizeNytBooksConfig(existing?.config);
      const provided = body.api_key.trim();
      const apiKey = provided || existingConfig?.api_key || "";
      const enabled = body.enabled ?? true;

      // Enabling without a key would leave the NYT shelf permanently failing on
      // authentication rather than saying what is missing.
      if (!apiKey && enabled) {
        return badRequest("api_key is required to enable NYT Books");
      }

      try {
        const now = nowUtc();
        const config = apiKey ? { api_key: encrypt(apiKey) } : {};
        const integration = await prisma.integration.upsert({
          where: { type: "nyt" },
          update: { enabled, config, updatedAt: now },
          create: {
            type: "nyt",
            enabled,
            config,
            createdAt: now,
            updatedAt: now,
          },
        });
        invalidateIntegrationConfigCache("nyt");

        await logActivity({
          type: "integration_updated",
          userId: c.get("user").id,
          payload: { integration_type: "nyt" },
        });

        return ok({
          success: true,
          integration: {
            type: integration.type,
            enabled: integration.enabled,
            api_key: "",
            has_api_key: Boolean(apiKey),
          },
        });
      } catch (error) {
        console.error("Error saving NYT Books integration config:", error);
        return serverError("Failed to save NYT Books integration");
      }
    },
  )

  /**
   * Check a key against the real API. Tests the request-body key when given, so
   * it can be verified before saving; otherwise the stored key. The NYT API is
   * rate-limited, so a 429 is reported as "quota exhausted", not "bad key".
   */
  .post(
    "/nyt/test",
    jsonV(z.object({ api_key: z.string().optional() })),
    async (c) => {
      const body = c.req.valid("json");
      const provided = body.api_key?.trim();
      let apiKey = provided ?? "";
      if (!apiKey) {
        const existing = await getIntegrationConfigRecord("nyt");
        apiKey = normalizeNytBooksConfig(existing?.config)?.api_key ?? "";
      }
      if (!apiKey) return badRequest("No API key to test");

      try {
        const res = await fetch(
          `${TEST_URL}?api-key=${encodeURIComponent(apiKey)}`,
          { signal: AbortSignal.timeout(15_000) },
        );
        if (res.ok) return ok({ success: true });

        if (res.status === 401 || res.status === 403) {
          return ok({ success: false, error: "NYT rejected that key." });
        }
        if (res.status === 429) {
          return ok({
            success: false,
            error: "Key accepted, but its quota is exhausted right now.",
          });
        }
        return ok({
          success: false,
          error: `NYT Books is unavailable (HTTP ${res.status}). The key may still be valid — try again shortly.`,
        });
      } catch (error) {
        return ok({
          success: false,
          error:
            error instanceof Error
              ? `Could not reach NYT Books: ${error.message}`
              : "Could not reach NYT Books.",
        });
      }
    },
  );
