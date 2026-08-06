import { Prisma } from "@prisma/client";
import type {
  DownloadClientHookConfig,
  DownloadClientHookStatus,
  DownloadClientIntegration,
  DownloadClientType,
} from "@rawkoon/shared/types/integrations";
import { Elysia, t } from "elysia";
import { auth } from "@rawkoon/api/auth";
import { prisma } from "@rawkoon/api/db";
import { badRequest, serverError } from "@rawkoon/api/errors";
import { requireAdmin } from "@rawkoon/api/middleware/auth";
import { encrypt } from "@rawkoon/api/services/crypto";
import {
  getDownloadClientIntegrationConfig,
  invalidateDownloadClientIntegrationConfigCache,
} from "@rawkoon/api/services/downloadClient/config";
import {
  buildDelugeScript,
  buildQbittorrentCommand,
  buildTransmissionScript,
  HOOK_PATH,
} from "@rawkoon/api/services/downloadClient/hookCommands";
import {
  getOrCreateHookToken,
  rotateHookToken,
} from "@rawkoon/api/services/downloadClient/hookToken";
import { buildAdapter } from "@rawkoon/api/services/downloadClient/registry";
import { applyQbittorrentAutorun } from "@rawkoon/api/services/qbittorrent/preferences";
import { logActivity } from "@rawkoon/api/utils/activityLogs";
import {
  isValidHttpUrl,
  normalizeUrl,
} from "@rawkoon/api/utils/integrations/utils";
import { nowUtc } from "@rawkoon/api/utils";
import { HOOK_RECENT_WINDOW_MS } from "@rawkoon/api/workers/checkDownloadCompletion";

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

/**
 * Foreign-program wins over every other state: the user has their own autorun
 * command, so nothing else we report about the hook is actionable until that is
 * resolved.
 */
export function computeHookStatus(input: {
  callbackUrl: string | null;
  lastSeenAt: Date | null;
  foreignProgram: boolean;
  nowMs: number;
}): DownloadClientHookStatus {
  if (input.foreignProgram) return "foreign-program";
  if (!input.callbackUrl) return "not-configured";
  if (!input.lastSeenAt) return "awaiting-first";
  const age = input.nowMs - input.lastSeenAt.getTime();
  return age >= 0 && age < HOOK_RECENT_WINDOW_MS ? "active" : "stale";
}

const rawConfig = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const stringValue = (value: unknown): string =>
  typeof value === "string" ? value : "";

const buildHookConfigResponse = async (input: {
  callbackUrl: string | null;
  autoConfigure: boolean;
  lastSeenAt: Date | null;
  activeHookedSecs: number;
  token: string;
  foreignProgram: boolean;
}): Promise<DownloadClientHookConfig> => {
  const baseUrl = input.callbackUrl ?? "";
  const generators = { baseUrl, token: input.token };
  return {
    status: computeHookStatus({
      callbackUrl: input.callbackUrl,
      lastSeenAt: input.lastSeenAt,
      foreignProgram: input.foreignProgram,
      nowMs: Date.now(),
    }),
    callbackUrl: input.callbackUrl,
    autoConfigure: input.autoConfigure,
    lastSeenAt: input.lastSeenAt?.toISOString() ?? null,
    activeHookedSecs: input.activeHookedSecs,
    token: input.token,
    qbittorrentCommand: buildQbittorrentCommand(generators),
    delugeScript: buildDelugeScript(generators),
    transmissionScript: buildTransmissionScript(generators),
  };
};

const readHookSettings = async () => {
  const settings = await prisma.mediaSettings.findUnique({
    where: { id: 1 },
    select: {
      downloadHookCallbackUrl: true,
      downloadHookAutoConfigure: true,
      downloadHookLastSeenAt: true,
      downloadPollActiveHookedSecs: true,
    },
  });
  return {
    callbackUrl: settings?.downloadHookCallbackUrl ?? null,
    autoConfigure: settings?.downloadHookAutoConfigure ?? true,
    lastSeenAt: settings?.downloadHookLastSeenAt ?? null,
    activeHookedSecs: settings?.downloadPollActiveHookedSecs ?? 120,
  };
};

/**
 * Best-effort qBittorrent autorun reconcile. Failures (client unreachable) must
 * not fail the settings write — the user's intent is to persist settings.
 * Returns whether the existing autorun program belongs to the user.
 */
const tryApplyQbittorrentAutorun = async (input: {
  callbackUrl: string | null;
  autoConfigure: boolean;
  token: string;
}): Promise<boolean> => {
  if (!input.callbackUrl || !input.autoConfigure) return false;

  const { clientType, config } = await getDownloadClientIntegrationConfig();
  if (clientType !== "qbittorrent" || !config) return false;

  try {
    const result = await applyQbittorrentAutorun(
      {
        website_url: config.website_url,
        username: config.username,
        password: config.password,
      },
      buildQbittorrentCommand({
        baseUrl: input.callbackUrl,
        token: input.token,
      }),
      HOOK_PATH,
    );
    return result.action === "skip-foreign";
  } catch (error) {
    console.warn(
      `[download-hook] failed to apply qBittorrent autorun (settings still saved): ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return false;
  }
};

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
    const { clientType, config } = await getDownloadClientIntegrationConfig();
    if (!clientType || !config) return { ok: false, error: "not configured" };
    return buildAdapter(clientType, config).testConnection();
  })
  .get("/download-client/hook", async ({ set }) => {
    try {
      const settings = await readHookSettings();
      const token = await getOrCreateHookToken();
      return await buildHookConfigResponse({
        ...settings,
        token,
        foreignProgram: false,
      });
    } catch (error) {
      console.error("Error fetching download-client hook config:", error);
      return serverError(set, "Failed to fetch download-client hook config");
    }
  })
  .put(
    "/download-client/hook",
    async ({ body, set }) => {
      try {
        const existing = await readHookSettings();

        let callbackUrl = existing.callbackUrl;
        if (body.callbackUrl !== undefined) {
          if (body.callbackUrl === null || body.callbackUrl.trim() === "") {
            callbackUrl = null;
          } else {
            const normalized = normalizeUrl(body.callbackUrl);
            if (!isValidHttpUrl(normalized)) {
              return badRequest(
                set,
                "Invalid callbackUrl. Must be a valid http(s) URL.",
              );
            }
            callbackUrl = normalized;
          }
        }

        const autoConfigure =
          body.autoConfigure !== undefined
            ? body.autoConfigure
            : existing.autoConfigure;

        let activeHookedSecs = existing.activeHookedSecs;
        if (body.activeHookedSecs !== undefined) {
          if (
            !Number.isFinite(body.activeHookedSecs) ||
            body.activeHookedSecs < 1
          ) {
            return badRequest(
              set,
              "activeHookedSecs must be a positive number",
            );
          }
          activeHookedSecs = Math.trunc(body.activeHookedSecs);
        }

        // upsert, not update: nothing seeds media_settings row 1.
        await prisma.mediaSettings.upsert({
          where: { id: 1 },
          update: {
            downloadHookCallbackUrl: callbackUrl,
            downloadHookAutoConfigure: autoConfigure,
            downloadPollActiveHookedSecs: activeHookedSecs,
          },
          create: {
            id: 1,
            downloadHookCallbackUrl: callbackUrl,
            downloadHookAutoConfigure: autoConfigure,
            downloadPollActiveHookedSecs: activeHookedSecs,
          },
        });

        const token = await getOrCreateHookToken();
        const foreignProgram = await tryApplyQbittorrentAutorun({
          callbackUrl,
          autoConfigure,
          token,
        });
        const settings = await readHookSettings();
        return await buildHookConfigResponse({
          ...settings,
          token,
          foreignProgram,
        });
      } catch (error) {
        console.error("Error saving download-client hook config:", error);
        return serverError(set, "Failed to save download-client hook config");
      }
    },
    {
      body: t.Object({
        callbackUrl: t.Optional(t.Union([t.String(), t.Null()])),
        autoConfigure: t.Optional(t.Boolean()),
        activeHookedSecs: t.Optional(t.Number()),
      }),
    },
  )
  .post("/download-client/hook/rotate", async ({ set }) => {
    try {
      const token = await rotateHookToken();
      const settings = await readHookSettings();
      const foreignProgram = await tryApplyQbittorrentAutorun({
        callbackUrl: settings.callbackUrl,
        autoConfigure: settings.autoConfigure,
        token,
      });
      return await buildHookConfigResponse({
        ...settings,
        token,
        foreignProgram,
      });
    } catch (error) {
      console.error("Error rotating download-client hook token:", error);
      return serverError(set, "Failed to rotate download-client hook token");
    }
  });
