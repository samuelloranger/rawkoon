import { Prisma } from "@prisma/client";
import type {
  DownloadClientIntegration,
  DownloadClientType,
} from "@rawkoon/shared/types/integrations";
import { Elysia, t } from "elysia";
import { auth } from "@rawkoon/api/auth";
import { prisma } from "@rawkoon/api/db";
import { badRequest, serverError } from "@rawkoon/api/errors";
import { requireAdmin } from "@rawkoon/api/middleware/auth";
import { encrypt } from "@rawkoon/api/services/crypto";
import { invalidateDownloadClientIntegrationConfigCache } from "@rawkoon/api/services/downloadClient/config";
import { resolveActiveAdapter } from "@rawkoon/api/services/downloadClient/registry";
import { logActivity } from "@rawkoon/api/utils/activityLogs";
import {
  isValidHttpUrl,
  normalizeUrl,
} from "@rawkoon/api/utils/integrations/utils";
import { nowUtc } from "@rawkoon/api/utils";

interface RawView {
  enabled: boolean;
  config: {
    client_type: DownloadClientType;
    website_url: string;
    username: string;
    password?: string;
    label: string;
    save_path?: string;
  };
}

export function buildDownloadClientIntegrationView(
  raw: RawView,
): DownloadClientIntegration {
  return {
    type: "download-client",
    enabled: raw.enabled,
    client_type: raw.config.client_type,
    website_url: raw.config.website_url,
    username: raw.config.username,
    password_set: Boolean(raw.config.password),
    label: raw.config.label,
    save_path: raw.config.save_path,
  };
}

const rawConfig = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const stringValue = (value: unknown): string =>
  typeof value === "string" ? value : "";

export const downloadClientIntegrationRoutes = new Elysia()
  .use(auth)
  .use(requireAdmin)
  .get("/download-client", async ({ set }) => {
    try {
      const integration = await prisma.integration.findFirst({
        where: { type: "download-client" },
      });
      const config = rawConfig(integration?.config);
      const clientType = stringValue(config.client_type);
      const validType: DownloadClientType =
        clientType === "transmission" || clientType === "deluge"
          ? clientType
          : "qbittorrent";
      return {
        integration: buildDownloadClientIntegrationView({
          enabled: integration?.enabled ?? false,
          config: {
            client_type: validType,
            website_url: stringValue(config.website_url),
            username: stringValue(config.username),
            password: stringValue(config.password) || undefined,
            label: stringValue(config.label) || "rawkoon",
            save_path: stringValue(config.save_path) || undefined,
          },
        }),
      };
    } catch (error) {
      console.error("Error fetching download-client config:", error);
      return serverError(set, "Failed to fetch download-client config");
    }
  })
  .put(
    "/download-client",
    async ({ user, body, set }) => {
      const websiteUrl = normalizeUrl(body.website_url);
      const username = body.username.trim();
      const label = body.label.trim() || "rawkoon";
      const savePath = body.save_path?.trim() || undefined;

      if (!websiteUrl || !isValidHttpUrl(websiteUrl)) {
        return badRequest(
          set,
          "Invalid website_url. Must be a valid http(s) URL.",
        );
      }
      if (body.client_type !== "deluge" && !username) {
        return badRequest(set, "username is required");
      }

      try {
        const existing = await prisma.integration.findFirst({
          where: { type: "download-client" },
        });
        const existingConfig = rawConfig(existing?.config);
        const providedPassword = body.password?.trim();
        const password = providedPassword
          ? encrypt(providedPassword)
          : stringValue(existingConfig.password);
        if (!password) return badRequest(set, "password is required");

        const enabled = body.enabled ?? existing?.enabled ?? true;
        const config: Prisma.InputJsonValue = {
          client_type: body.client_type,
          website_url: websiteUrl,
          username,
          password,
          label,
          ...(savePath ? { save_path: savePath } : {}),
        };
        const integration = await prisma.integration.upsert({
          where: { type: "download-client" },
          update: { enabled, config, updatedAt: nowUtc() },
          create: {
            type: "download-client",
            enabled,
            config,
            createdAt: nowUtc(),
            updatedAt: nowUtc(),
          },
        });
        await invalidateDownloadClientIntegrationConfigCache();
        await logActivity({
          type: "integration_updated",
          userId: user!.id,
          payload: {
            integration_type: "download-client",
            client_type: body.client_type,
          },
        });
        return {
          success: true,
          integration: buildDownloadClientIntegrationView({
            enabled: integration.enabled,
            config: {
              client_type: body.client_type,
              website_url: websiteUrl,
              username,
              password,
              label,
              save_path: savePath,
            },
          }),
        };
      } catch (error) {
        console.error("Error saving download-client config:", error);
        return serverError(set, "Failed to save download-client config");
      }
    },
    {
      body: t.Object({
        client_type: t.Union([
          t.Literal("qbittorrent"),
          t.Literal("transmission"),
          t.Literal("deluge"),
        ]),
        website_url: t.String(),
        username: t.String(),
        password: t.Optional(t.String()),
        enabled: t.Optional(t.Boolean()),
        label: t.String(),
        save_path: t.Optional(t.String()),
      }),
    },
  )
  .post("/download-client/test", async () => {
    const active = await resolveActiveAdapter();
    if (!active) return { ok: false, error: "not configured" };
    return active.adapter.testConnection();
  });
