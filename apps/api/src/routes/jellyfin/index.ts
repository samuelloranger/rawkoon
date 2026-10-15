import { Hono } from "hono";
import { z } from "zod";
import { prisma } from "@rawkoon/api/db";
import {
  badGateway,
  forbidden,
  ok,
  serviceUnavailable,
  unauthorized,
} from "@rawkoon/api/errors";
import type { Env } from "@rawkoon/api/honoEnv";
import { auth as betterAuth } from "@rawkoon/api/lib/auth";
import { jsonV } from "@rawkoon/api/middleware/validate";
import {
  getJellyfinConfig,
  JELLYFIN_SESSION_AGENT_PREFIX,
  resolveJellyfinTokenUser,
} from "@rawkoon/api/services/jellyfinUsers";

const sessionBody = z.object({
  jellyfin_token: z.string().min(1).max(512),
  device_name: z.string().max(100).optional(),
});

// Public: a Jellyfin client (e.g. the TV app) trades its Jellyfin access token
// for a Rawkoon bearer session belonging to the linked Rawkoon user. The session
// is a normal one: revoke it from the sessions page or by relinking the user.
export const jellyfinSessionRoutes = new Hono<Env>().post(
  "/api/jellyfin/session",
  jsonV(sessionBody),
  async (c) => {
    const body = c.req.valid("json");
    const config = await getJellyfinConfig();
    if (!config) {
      return serviceUnavailable("Jellyfin integration is not configured");
    }

    let jellyfinUser: Awaited<ReturnType<typeof resolveJellyfinTokenUser>>;
    try {
      jellyfinUser = await resolveJellyfinTokenUser(
        config,
        body.jellyfin_token,
      );
    } catch (error) {
      console.error("[jellyfin-session] Jellyfin lookup failed:", error);
      return badGateway("Failed to reach Jellyfin");
    }
    if (!jellyfinUser) return unauthorized("Jellyfin rejected the token");

    const user = await prisma.user.findUnique({
      where: { jellyfinUserId: jellyfinUser.id },
    });
    if (!user) {
      return forbidden(
        "This Jellyfin account is not linked to a Rawkoon user. Ask an admin to link it.",
      );
    }

    const ctx = await betterAuth.$context;
    const deviceName = body.device_name?.trim() || "Jellyfin client";
    const session = await ctx.internalAdapter.createSession(user.id, false, {
      userAgent: `${JELLYFIN_SESSION_AGENT_PREFIX}${deviceName}`,
    });

    return ok({
      token: session.token,
      user: {
        id: user.id,
        name: user.name || user.firstName || user.email,
        is_admin: user.isAdmin ?? false,
      },
    });
  },
);
