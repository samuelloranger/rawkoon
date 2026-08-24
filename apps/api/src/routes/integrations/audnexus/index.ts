import { Elysia, t } from "elysia";
import { auth } from "@rawkoon/api/auth";
import { prisma } from "@rawkoon/api/db";
import {
  getIntegrationConfigRecord,
  invalidateIntegrationConfigCache,
} from "@rawkoon/api/services/integrationConfigCache";
import { nowUtc } from "@rawkoon/api/utils";
import {
  AUDNEXUS_DEFAULT_BASE_URL,
  AUDNEXUS_DEFAULT_REGION,
  normalizeAudnexusConfig,
} from "@rawkoon/api/utils/integrations/normalizers";
import { logActivity } from "@rawkoon/api/utils/activityLogs";
import { requireAdmin } from "@rawkoon/api/middleware/auth";
import { badRequest, serverError } from "@rawkoon/api/errors";

/**
 * Audnexus integration.
 *
 * Deliberately simpler than the Google Books routes: there is no secret. The
 * public instance is keyless, so nothing is encrypted and the whole config is
 * safe to echo back to the UI.
 *
 * `base_url` exists so a self-hosted instance can be used instead — the project
 * publishes no prebuilt image, so that means building from source.
 */

/**
 * A known-good public-domain ASIN would still tie this health check to one
 * catalogue entry, so the probe hits the ASIN-shaped 404 path instead: any
 * answer at all proves the instance is reachable and speaking JSON.
 */
const TEST_ASIN = "B00000000X";

export const audnexusIntegrationRoutes = new Elysia()
  .use(auth)
  .use(requireAdmin)

  .get("/audnexus", async ({ set }) => {
    try {
      const integration = await getIntegrationConfigRecord("audnexus");
      const config = normalizeAudnexusConfig(integration?.config ?? {});
      return {
        integration: {
          type: "audnexus",
          enabled: integration?.enabled ?? false,
          base_url: config?.base_url ?? AUDNEXUS_DEFAULT_BASE_URL,
          region: config?.region ?? AUDNEXUS_DEFAULT_REGION,
        },
      };
    } catch (error) {
      console.error("Error fetching Audnexus integration config:", error);
      return serverError(set, "Failed to fetch Audnexus integration config");
    }
  })

  .put(
    "/audnexus",
    async ({ user, body, set }) => {
      const config = normalizeAudnexusConfig({
        base_url: body.base_url ?? "",
        region: body.region ?? "",
      });
      // The normalizer only rejects a malformed or non-http base URL, which is
      // the one setting that would make every request fail invisibly.
      if (!config) {
        return badRequest(set, "base_url must be a valid http(s) URL");
      }
      const enabled = body.enabled ?? true;

      try {
        const now = nowUtc();
        const integration = await prisma.integration.upsert({
          where: { type: "audnexus" },
          update: { enabled, config: { ...config }, updatedAt: now },
          create: {
            type: "audnexus",
            enabled,
            config: { ...config },
            createdAt: now,
            updatedAt: now,
          },
        });
        invalidateIntegrationConfigCache("audnexus");

        await logActivity({
          type: "integration_updated",
          userId: user!.id,
          payload: { integration_type: "audnexus" },
        });

        return {
          success: true,
          integration: {
            type: integration.type,
            enabled: integration.enabled,
            base_url: config.base_url,
            region: config.region,
          },
        };
      } catch (error) {
        console.error("Error saving Audnexus integration config:", error);
        return serverError(set, "Failed to save Audnexus integration");
      }
    },
    {
      body: t.Object({
        base_url: t.Optional(t.String()),
        region: t.Optional(t.String()),
        enabled: t.Optional(t.Boolean()),
      }),
    },
  )

  /**
   * Reachability check.
   *
   * Tests the values in the request body when given, so an instance can be
   * verified before it is saved. A 404 counts as success: it proves the host is
   * up and routing, which is what this check is for. Only a transport failure
   * or a 5xx is a real failure — reporting a rate limit as "broken" would send
   * someone reconfiguring a working instance.
   */
  .post(
    "/audnexus/test",
    async ({ body, set }) => {
      const config = normalizeAudnexusConfig({
        base_url: body.base_url ?? "",
        region: body.region ?? "",
      });
      if (!config)
        return badRequest(set, "base_url must be a valid http(s) URL");

      const url = `${config.base_url}/books/${TEST_ASIN}?region=${encodeURIComponent(config.region)}`;
      try {
        const res = await fetch(url, {
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(15_000),
        });
        if (res.ok || res.status === 404) return { success: true };
        if (res.status === 429) {
          return {
            success: false,
            error: "Reachable, but rate-limited right now. Try again shortly.",
          };
        }
        return {
          success: false,
          error: `Audnexus returned HTTP ${res.status}.`,
        };
      } catch (error) {
        return {
          success: false,
          error:
            error instanceof Error
              ? `Could not reach Audnexus: ${error.message}`
              : "Could not reach Audnexus.",
        };
      }
    },
    {
      body: t.Object({
        base_url: t.Optional(t.String()),
        region: t.Optional(t.String()),
      }),
    },
  );
