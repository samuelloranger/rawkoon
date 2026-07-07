import { Elysia, t } from "elysia";
import { Prisma } from "@prisma/client";
import { auth } from "@rawkoon/api/auth";
import { prisma } from "@rawkoon/api/db";
import { nowUtc } from "@rawkoon/api/utils";
import {
  normalizeQbittorrentConfig,
  invalidateQbittorrentIntegrationConfigCache,
  getQbittorrentIntegrationConfig,
} from "@rawkoon/api/services/qbittorrent/config";
import {
  isValidHttpUrl,
  normalizeUrl,
} from "@rawkoon/api/utils/integrations/utils";
import { encrypt } from "@rawkoon/api/services/crypto";
import { randomBytes } from "node:crypto";
import { logActivity } from "@rawkoon/api/utils/activityLogs";
import { requireAdmin } from "@rawkoon/api/middleware/auth";
import { badRequest, serverError } from "@rawkoon/api/errors";
import { getBaseUrl, loadConfig } from "@rawkoon/api/config";
import { qbFetchText } from "@rawkoon/api/services/qbittorrent/clientFetch";
import { lookup as dnsLookup } from "node:dns/promises";

/**
 * Resolve the URL qBittorrent should use to reach Rawkoon internally.
 *
 * Priority:
 *   1. Explicit override from the request body
 *   2. Docker service DNS — probe "rawkoon" on the configured API port.
 *      Inside Docker, the service name is always resolvable from the same
 *      homelab_network, so this works for qBittorrent (via vpn-stack) without
 *      any env-var configuration.
 *   3. BASE_URL fallback (public URL — last resort)
 */
async function resolveRawkoonInternalUrl(override?: string): Promise<string> {
  if (override) {
    let parsed: URL;
    try {
      parsed = new URL(override);
    } catch {
      throw new Error("Rawkoon URL override is not a valid URL");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("Rawkoon URL override must use http or https");
    }
    return override.replace(/\/$/, "");
  }

  const port = loadConfig().API_PORT;
  try {
    await dnsLookup("rawkoon");
    return `http://rawkoon:${port}`;
  } catch {
    return getBaseUrl().replace(/\/$/, "");
  }
}

export const qbittorrentIntegrationRoutes = new Elysia()
  .use(auth)
  .use(requireAdmin)
  .get("/qbittorrent", async ({ user: _user, set }) => {
    try {
      const integration = await prisma.integration.findFirst({
        where: { type: "qbittorrent" },
      });

      const config = normalizeQbittorrentConfig(integration?.config);
      return {
        integration: {
          type: "qbittorrent",
          enabled: integration?.enabled || false,
          website_url: config?.website_url || "",
          username: config?.username || "",
          password_set: Boolean(config?.password),
          rawkoon_base_url: getBaseUrl(),
          webhook_secret_configured: Boolean(config?.webhook_secret),
        },
      };
    } catch (error) {
      console.error("Error fetching qBittorrent integration config:", error);
      return serverError(set, "Failed to fetch qBittorrent integration config");
    }
  })
  .put(
    "/qbittorrent",
    async ({ user, body, set }) => {
      const websiteUrl = normalizeUrl(body.website_url);
      const username = body.username.trim();

      if (!websiteUrl || !isValidHttpUrl(websiteUrl)) {
        return badRequest(
          set,
          "Invalid website_url. Must be a valid http(s) URL.",
        );
      }

      if (!username) {
        return badRequest(set, "username is required");
      }

      try {
        const existingIntegration = await prisma.integration.findFirst({
          where: { type: "qbittorrent" },
        });
        const existingConfig = normalizeQbittorrentConfig(
          existingIntegration?.config,
        );
        const providedPassword = body.password?.trim() || "";
        const password = providedPassword || existingConfig?.password || "";

        if (!password) {
          return badRequest(set, "password is required");
        }

        // Auto-generate a webhook secret on first save; preserve it on subsequent saves.
        const webhookSecret =
          existingConfig?.webhook_secret || randomBytes(16).toString("hex");

        const now = nowUtc();
        const enabled = body.enabled ?? existingIntegration?.enabled ?? true;
        const config: Prisma.InputJsonValue = {
          website_url: websiteUrl,
          username,
          password: encrypt(password),
          webhook_secret: encrypt(webhookSecret),
        };

        const integration = await prisma.integration.upsert({
          where: { type: "qbittorrent" },
          update: {
            enabled,
            config,
            updatedAt: now,
          },
          create: {
            type: "qbittorrent",
            enabled,
            config,
            createdAt: now,
            updatedAt: now,
          },
        });

        await invalidateQbittorrentIntegrationConfigCache();

        await logActivity({
          type: "integration_updated",
          userId: user!.id,
          payload: { integration_type: "qbittorrent" },
        });

        return {
          success: true,
          integration: {
            type: integration.type,
            enabled: integration.enabled,
            website_url: websiteUrl,
            username,
            password_set: true,
          },
        };
      } catch (error) {
        console.error("Error saving qBittorrent integration config:", error);
        return serverError(
          set,
          "Failed to save qBittorrent integration config",
        );
      }
    },
    {
      body: t.Object({
        website_url: t.String(),
        username: t.String(),
        password: t.Optional(t.String()),
        enabled: t.Optional(t.Boolean()),
      }),
    },
  )
  .post(
    "/qbittorrent/autorun-setup",
    async ({ body, set }) => {
      const qb = await getQbittorrentIntegrationConfig();
      if (!qb.enabled || !qb.config) {
        return badRequest(
          set,
          "qBittorrent integration is not configured or disabled.",
        );
      }

      const secret = qb.config.webhook_secret;
      if (!secret) {
        return badRequest(
          set,
          "Webhook secret not generated yet. Save the integration settings first.",
        );
      }

      let rawkoonUrl: string;
      try {
        rawkoonUrl = await resolveRawkoonInternalUrl(body.rawkoon_url?.trim());
      } catch (e) {
        return badRequest(
          set,
          e instanceof Error ? e.message : "Invalid Rawkoon URL",
        );
      }

      // Build the autorun commands. qBittorrent substitutes %I (info hash) before
      // spawning via QProcess::splitCommand, which only understands double-quote
      // grouping (NOT single quotes). We call curl directly — no shell needed —
      // and pass the hash as a URL query parameter to avoid any JSON quoting.
      const makeCmd = (endpoint: string) =>
        `/usr/bin/curl -s -X POST "${rawkoonUrl}${endpoint}?hash=%I" -H "Authorization: Bearer ${secret}"`;

      const prefs = {
        autorun_enabled: true,
        autorun_program: makeCmd("/api/webhooks/qbittorrent/completed"),
        // autorun_on_torrent_added_* requires qBittorrent ≥ 4.5.0
        autorun_on_torrent_added_enabled: true,
        autorun_on_torrent_added_program: makeCmd(
          "/api/webhooks/qbittorrent/added",
        ),
      };

      try {
        const formBody = new URLSearchParams({ json: JSON.stringify(prefs) });
        await qbFetchText(qb.config, "/api/v2/app/setPreferences", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: formBody.toString(),
        });
        return { success: true, rawkoon_url: rawkoonUrl };
      } catch (error) {
        console.error("Error configuring qBittorrent autorun:", error);
        return serverError(
          set,
          "Failed to update qBittorrent preferences. Check that qBittorrent is reachable.",
        );
      }
    },
    {
      body: t.Object({
        rawkoon_url: t.Optional(t.String()),
      }),
    },
  );
