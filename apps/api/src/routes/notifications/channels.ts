import { Hono } from "hono";
import { z } from "zod";
import { APP_PATHS } from "@rawkoon/shared/constants";
import { badRequest, notFound, ok, serverError } from "@rawkoon/api/errors";
import type { Env } from "@rawkoon/api/honoEnv";
import { requireUser } from "@rawkoon/api/middleware/hono/auth";
import { jsonV } from "@rawkoon/api/middleware/validate";
import {
  createChannel,
  deleteChannel,
  findChannel,
  listChannels,
  updateChannel,
} from "@rawkoon/api/services/notification/notificationChannels";
import {
  dispatchToChannel,
  parseNtfyConfig,
  parseTelegramConfig,
  parseDiscordConfig,
  parseGotifyConfig,
  parsePushoverConfig,
  parseSlackConfig,
  parseWebhookConfig,
} from "@rawkoon/api/utils/notifications/channelDispatchers";
import { getBaseUrl } from "@rawkoon/api/config";
import type { NotificationChannel } from "@rawkoon/shared";

// Add new provider keys here when implementing them.
const VALID_TYPES = [
  "ntfy",
  "telegram",
  "discord",
  "gotify",
  "pushover",
  "slack",
  "webhook",
] as const;

function mapChannel(row: {
  id: number;
  type: string;
  label: string;
  config: unknown;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}): NotificationChannel {
  return {
    id: row.id,
    type: row.type as NotificationChannel["type"],
    label: row.label,
    config: row.config as NotificationChannel["config"],
    enabled: row.enabled,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

function parseId(raw: string): number | null {
  const id = parseInt(raw, 10);
  return isNaN(id) ? null : id;
}

function validateConfig(type: string, config: unknown): string | null {
  const parsers: Record<string, (c: unknown) => unknown> = {
    ntfy: parseNtfyConfig,
    telegram: parseTelegramConfig,
    discord: parseDiscordConfig,
    gotify: parseGotifyConfig,
    pushover: parsePushoverConfig,
    slack: parseSlackConfig,
    webhook: parseWebhookConfig,
  };
  const parse = parsers[type];
  if (parse) {
    try {
      parse(config);
    } catch (err) {
      return err instanceof Error ? err.message : "Invalid config";
    }
  }
  return null;
}

const createBody = z.object({
  type: z.string(),
  label: z.string().min(1).max(100),
  config: z.record(z.string(), z.unknown()),
});

const patchBody = z.object({
  label: z.string().min(1).max(100).optional(),
  enabled: z.boolean().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});

// Mounted at /channels by the notifications root. Guards are route-level.
export const notificationChannelsRoutes = new Hono<Env>()
  .get("/", requireUser, async (c) => {
    try {
      const channels = await listChannels(c.get("user").id);
      return ok({ channels: channels.map(mapChannel) });
    } catch {
      return serverError("Failed to fetch notification channels");
    }
  })

  .post("/", requireUser, jsonV(createBody), async (c) => {
    const user = c.get("user");
    const body = c.req.valid("json");
    if (!VALID_TYPES.includes(body.type as (typeof VALID_TYPES)[number])) {
      return badRequest(`type must be one of: ${VALID_TYPES.join(", ")}`);
    }
    const configErr = validateConfig(body.type, body.config);
    if (configErr) return badRequest(configErr);
    try {
      const channel = await createChannel({
        userId: user.id,
        type: body.type,
        label: body.label,
        config: body.config as object,
      });
      return ok({ channel: mapChannel(channel) });
    } catch {
      return serverError("Failed to create notification channel");
    }
  })

  .patch("/:id", requireUser, jsonV(patchBody), async (c) => {
    const user = c.get("user");
    const body = c.req.valid("json");
    const id = parseId(c.req.param("id"));
    if (id === null) return badRequest("Invalid channel id");
    try {
      const existing = await findChannel(id, user.id);
      if (!existing) return notFound("Channel not found");

      if (body.config !== undefined) {
        const configErr = validateConfig(existing.type, body.config);
        if (configErr) return badRequest(configErr);
      }

      const channel = await updateChannel(id, user.id, {
        label: body.label,
        enabled: body.enabled,
        config: body.config as object | undefined,
      });
      if (!channel) return notFound("Channel not found");
      return ok({ channel: mapChannel(channel) });
    } catch {
      return serverError("Failed to update notification channel");
    }
  })

  .delete("/:id", requireUser, async (c) => {
    const user = c.get("user");
    const id = parseId(c.req.param("id"));
    if (id === null) return badRequest("Invalid channel id");
    try {
      const existing = await findChannel(id, user.id);
      if (!existing) return notFound("Channel not found");
      if (!(await deleteChannel(id, user.id)))
        return notFound("Channel not found");
      return ok({ success: true });
    } catch {
      return serverError("Failed to delete notification channel");
    }
  })

  .post("/:id/test", requireUser, async (c) => {
    const user = c.get("user");
    const id = parseId(c.req.param("id"));
    if (id === null) return badRequest("Invalid channel id");
    try {
      const channel = await findChannel(id, user.id);
      if (!channel) return notFound("Channel not found");

      await dispatchToChannel(mapChannel(channel), {
        title: "Rawkoon test notification",
        body: "If you see this, your notification channel is working.",
        url: `${getBaseUrl().replace(/\/$/, "")}${APP_PATHS.settingsAlerts}`,
      });
      return ok({ success: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Dispatch failed";
      return badRequest(msg);
    }
  });
