import { Elysia, t } from "elysia";
import { auth } from "@rawkoon/api/auth";
import { requireUser } from "@rawkoon/api/middleware/auth";
import { prisma } from "@rawkoon/api/db";
import { badRequest, notFound, serverError } from "@rawkoon/api/errors";
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

export const notificationChannelsRoutes = new Elysia({ prefix: "/channels" })
  .use(auth)
  .use(requireUser)

  // GET /api/notifications/channels
  .get("/", async ({ user, set }) => {
    try {
      const channels = await prisma.notificationChannel.findMany({
        where: { userId: user!.id },
        orderBy: { createdAt: "asc" },
      });
      return { channels: channels.map(mapChannel) };
    } catch {
      return serverError(set, "Failed to fetch notification channels");
    }
  })

  // POST /api/notifications/channels
  .post(
    "/",
    async ({ user, body, set }) => {
      if (!VALID_TYPES.includes(body.type as (typeof VALID_TYPES)[number])) {
        return badRequest(
          set,
          `type must be one of: ${VALID_TYPES.join(", ")}`,
        );
      }
      const configErr = validateConfig(body.type, body.config);
      if (configErr) return badRequest(set, configErr);
      try {
        const channel = await prisma.notificationChannel.create({
          data: {
            userId: user!.id,
            type: body.type,
            label: body.label,
            config: body.config as object,
            enabled: true,
          },
        });
        return { channel: mapChannel(channel) };
      } catch {
        return serverError(set, "Failed to create notification channel");
      }
    },
    {
      body: t.Object({
        type: t.String(),
        label: t.String({ minLength: 1, maxLength: 100 }),
        config: t.Record(t.String(), t.Unknown()),
      }),
    },
  )

  // PATCH /api/notifications/channels/:id
  .patch(
    "/:id",
    async ({ user, params, body, set }) => {
      const id = parseId(params.id);
      if (id === null) return badRequest(set, "Invalid channel id");
      try {
        const existing = await prisma.notificationChannel.findFirst({
          where: { id, userId: user!.id },
        });
        if (!existing) return notFound(set, "Channel not found");

        if (body.config !== undefined) {
          const configErr = validateConfig(existing.type, body.config);
          if (configErr) return badRequest(set, configErr);
        }

        const result = await prisma.notificationChannel.updateMany({
          where: { id, userId: user!.id },
          data: {
            ...(body.label !== undefined ? { label: body.label } : {}),
            ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
            ...(body.config !== undefined
              ? { config: body.config as object }
              : {}),
          },
        });
        if (result.count === 0) return notFound(set, "Channel not found");

        const channel = await prisma.notificationChannel.findUnique({
          where: { id },
        });
        if (!channel) return notFound(set, "Channel not found");
        return { channel: mapChannel(channel) };
      } catch {
        return serverError(set, "Failed to update notification channel");
      }
    },
    {
      body: t.Object({
        label: t.Optional(t.String({ minLength: 1, maxLength: 100 })),
        enabled: t.Optional(t.Boolean()),
        config: t.Optional(t.Record(t.String(), t.Unknown())),
      }),
    },
  )

  // DELETE /api/notifications/channels/:id
  .delete("/:id", async ({ user, params, set }) => {
    const id = parseId(params.id);
    if (id === null) return badRequest(set, "Invalid channel id");
    try {
      const existing = await prisma.notificationChannel.findFirst({
        where: { id, userId: user!.id },
      });
      if (!existing) return notFound(set, "Channel not found");
      const result = await prisma.notificationChannel.deleteMany({
        where: { id, userId: user!.id },
      });
      if (result.count === 0) return notFound(set, "Channel not found");
      return { success: true };
    } catch {
      return serverError(set, "Failed to delete notification channel");
    }
  })

  // POST /api/notifications/channels/:id/test
  .post("/:id/test", async ({ user, params, set }) => {
    const id = parseId(params.id);
    if (id === null) return badRequest(set, "Invalid channel id");
    try {
      const channel = await prisma.notificationChannel.findFirst({
        where: { id, userId: user!.id },
      });
      if (!channel) return notFound(set, "Channel not found");

      await dispatchToChannel(mapChannel(channel), {
        title: "Rawkoon test notification",
        body: "If you see this, your notification channel is working.",
        url: `${getBaseUrl().replace(/\/$/, "")}/settings?tab=notifications`,
      });
      return { success: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Dispatch failed";
      return badRequest(set, msg);
    }
  });
