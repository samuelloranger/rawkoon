import { Hono } from "hono";
import { z } from "zod";
import { prisma } from "@rawkoon/api/db";
import {
  getIntegrationConfigRecord,
  invalidateIntegrationConfigCache,
} from "@rawkoon/api/services/integrationConfigCache";
import { nowUtc } from "@rawkoon/api/utils";
import { normalizeGoogleBooksConfig } from "@rawkoon/api/utils/integrations/normalizers";
import { encrypt } from "@rawkoon/api/services/crypto";
import { logActivity } from "@rawkoon/api/utils/activityLogs";
import { badRequest, ok, serverError } from "@rawkoon/api/errors";
import type { Env } from "@rawkoon/api/honoEnv";
import { jsonV } from "@rawkoon/api/middleware/validate";

/**
 * Google Books integration.
 *
 * Mirrors the TMDB routes: the stored key is never returned, and an empty
 * `api_key` on save means "keep the existing one" so the form can be submitted
 * without retyping a secret.
 *
 * This exists because the key MUST be encrypted with the instance's SECRET_KEY
 * — a value written straight into the config column is treated as unconfigured
 * by the normalizer, which is why it previously needed a maintenance script.
 */

const TEST_URL =
  "https://www.googleapis.com/books/v1/volumes?q=isbn:9780000000000&maxResults=1";

// Mounted under /api/integrations; requireAdmin is applied at the parent.
export const googleBooksIntegrationRoutes = new Hono<Env>()
  .get("/googlebooks", async () => {
    try {
      const integration = await getIntegrationConfigRecord("googlebooks");
      const config = normalizeGoogleBooksConfig(integration?.config);
      return ok({
        integration: {
          type: "googlebooks",
          enabled: integration?.enabled ?? false,
          // Never echo the secret; the UI shows whether one is stored instead.
          api_key: "",
          has_api_key: Boolean(config?.api_key),
        },
      });
    } catch (error) {
      console.error("Error fetching Google Books integration config:", error);
      return serverError("Failed to fetch Google Books integration config");
    }
  })

  .put(
    "/googlebooks",
    jsonV(z.object({ api_key: z.string(), enabled: z.boolean().optional() })),
    async (c) => {
      const body = c.req.valid("json");
      const existing = await getIntegrationConfigRecord("googlebooks");
      const existingConfig = normalizeGoogleBooksConfig(existing?.config);
      const provided = body.api_key.trim();
      const apiKey = provided || existingConfig?.api_key || "";
      const enabled = body.enabled ?? true;

      // Enabling without a key would leave every book search failing with an
      // authentication error rather than saying what is missing.
      if (!apiKey && enabled) {
        return badRequest("api_key is required to enable Google Books");
      }

      try {
        const now = nowUtc();
        const config = apiKey ? { api_key: encrypt(apiKey) } : {};
        const integration = await prisma.integration.upsert({
          where: { type: "googlebooks" },
          update: { enabled, config, updatedAt: now },
          create: {
            type: "googlebooks",
            enabled,
            config,
            createdAt: now,
            updatedAt: now,
          },
        });
        invalidateIntegrationConfigCache("googlebooks");

        await logActivity({
          type: "integration_updated",
          userId: c.get("user").id,
          payload: { integration_type: "googlebooks" },
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
        console.error("Error saving Google Books integration config:", error);
        return serverError("Failed to save Google Books integration");
      }
    },
  )

  /**
   * Check a key against the real API.
   *
   * Tests the key in the request body when one is given, so it can be verified
   * before being saved; otherwise the stored key. Google Books answers 503 for
   * valid keys often enough that the response distinguishes "rejected" from
   * "unreachable" — reporting a transient outage as a bad key would send
   * someone hunting for a credential problem that does not exist.
   */
  .post(
    "/googlebooks/test",
    jsonV(z.object({ api_key: z.string().optional() })),
    async (c) => {
      const body = c.req.valid("json");
      const provided = body.api_key?.trim();
      let apiKey = provided ?? "";
      if (!apiKey) {
        const existing = await getIntegrationConfigRecord("googlebooks");
        apiKey = normalizeGoogleBooksConfig(existing?.config)?.api_key ?? "";
      }
      if (!apiKey) return badRequest("No API key to test");

      try {
        const res = await fetch(
          `${TEST_URL}&key=${encodeURIComponent(apiKey)}`,
          {
            signal: AbortSignal.timeout(15_000),
          },
        );
        if (res.ok) return ok({ success: true });

        if (res.status === 400 || res.status === 403) {
          return ok({
            success: false,
            error: "Google Books rejected that key.",
          });
        }
        if (res.status === 429) {
          return ok({
            success: false,
            error: "Key accepted, but its quota is exhausted right now.",
          });
        }
        return ok({
          success: false,
          error: `Google Books is unavailable (HTTP ${res.status}). The key may still be valid — try again shortly.`,
        });
      } catch (error) {
        return ok({
          success: false,
          error:
            error instanceof Error
              ? `Could not reach Google Books: ${error.message}`
              : "Could not reach Google Books.",
        });
      }
    },
  );
