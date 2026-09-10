import { Hono } from "hono";
import { z } from "zod";
import { prisma } from "@rawkoon/api/db";
import { badRequest, notFound, ok, serverError } from "@rawkoon/api/errors";
import type { Env } from "@rawkoon/api/honoEnv";
import { requireUser } from "@rawkoon/api/middleware/hono/auth";
import { jsonV } from "@rawkoon/api/middleware/validate";
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
  // GET /api/notifications/channels
  .get("/", requireUser, async (c) => {
    try {
      const channels = await prisma.notificationChannel.findMany({
        where: { userId: c.get("user").id },
        orderBy: { createdAt: "asc" },
      });
      return ok({ channels: channels.map(mapChannel) });
    } catch {
      return serverError("Failed to fetch notification channels");
    }
  })

  // POST /api/notifications/channels
  .post("/", requireUser, jsonV(createBody), async (c) => {
    const user = c.get("user");
    const body = c.req.valid("json");
    if (!VALID_TYPES.includes(body.type as (typeof VALID_TYPES)[number])) {
      return badRequest(`type must be one of: ${VALID_TYPES.join(", ")}`);
    }
    const configErr = validateConfig(body.type, body.config);
    if (configErr) return badRequest(configErr);
    try {
      const channel = await prisma.notificationChannel.create({
        data: {
          userId: user.id,
          type: body.type,
          label: body.label,
          config: body.config as object,
          enabled: true,
        },
      });
      return ok({ channel: mapChannel(channel) });
    } catch {
      return serverError("Failed to create notification channel");
    }
  })

  // PATCH /api/notifications/channels/:id
  .patch("/:id", requireUser, jsonV(patchBody), async (c) => {
    const user = c.get("user");
    const body = c.req.valid("json");
    const id = parseId(c.req.param("id"));
    if (id === null) return badRequest("Invalid channel id");
    try {
      const existing = await prisma.notificationChannel.findFirst({
        where: { id, userId: user.id },
      });
      if (!existing) return notFound("Channel not found");

      if (body.config !== undefined) {
        const configErr = validateConfig(existing.type, body.config);
        if (configErr) return badRequest(configErr);
      }

      const result = await prisma.notificationChannel.updateMany({
        where: { id, userId: user.id },
        data: {
          ...(body.label !== undefined ? { label: body.label } : {}),
          ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
          ...(body.config !== undefined
            ? { config: body.config as object }
            : {}),
        },
      });
      if (result.count === 0) return notFound("Channel not found");

      const channel = await prisma.notificationChannel.findUnique({
        where: { id },
      });
      if (!channel) return notFound("Channel not found");
      return ok({ channel: mapChannel(channel) });
    } catch {
      return serverError("Failed to update notification channel");
    }
  })

  // DELETE /api/notifications/channels/:id
  .delete("/:id", requireUser, async (c) => {
    const user = c.get("user");
    const id = parseId(c.req.param("id"));
    if (id === null) return badRequest("Invalid channel id");
    try {
      const existing = await prisma.notificationChannel.findFirst({
        where: { id, userId: user.id },
      });
      if (!existing) return notFound("Channel not found");
      const result = await prisma.notificationChannel.deleteMany({
        where: { id, userId: user.id },
      });
      if (result.count === 0) return notFound("Channel not found");
      return ok({ success: true });
    } catch {
      return serverError("Failed to delete notification channel");
    }
  })

  // POST /api/notifications/channels/:id/test
  .post("/:id/test", requireUser, async (c) => {
    const user = c.get("user");
    const id = parseId(c.req.param("id"));
    if (id === null) return badRequest("Invalid channel id");
    try {
      const channel = await prisma.notificationChannel.findFirst({
        where: { id, userId: user.id },
      });
      if (!channel) return notFound("Channel not found");

      await dispatchToChannel(mapChannel(channel), {
        title: "Rawkoon test notification",
        body: "If you see this, your notification channel is working.",
        url: `${getBaseUrl().replace(/\/$/, "")}/settings?tab=notifications`,
      });
      return ok({ success: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Dispatch failed";
      return badRequest(msg);
    }
  });
