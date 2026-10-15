import { Hono } from "hono";
import { z } from "zod";
import { prisma } from "@rawkoon/api/db";
import {
  badGateway,
  forbidden,
  notFound,
  ok,
  serviceUnavailable,
} from "@rawkoon/api/errors";
import type { Env } from "@rawkoon/api/honoEnv";
import { requireUser } from "@rawkoon/api/middleware/hono/auth";
import { jsonV } from "@rawkoon/api/middleware/validate";
import { getIntegrationConfigRecord } from "@rawkoon/api/services/integrationConfigCache";
import {
  authorizeJellyfinQuickConnect,
  getJellyfinConfig,
} from "@rawkoon/api/services/jellyfinUsers";
import { normalizeTmdbConfig } from "@rawkoon/api/utils/integrations/normalizers";

// Mounted at /api/tv. Guards are per route: a .use("*") here would leak into
// sibling routers merged at the same level.
export const tvRoutes = new Hono<Env>()
  // Everything a signed-in TV needs to set itself up: the Jellyfin server to
  // play from and the TMDB key for discovery.
  .get("/bootstrap", requireUser, async (c) => {
    const sessionUser = c.get("user");
    const [user, jellyfin, tmdbIntegration] = await Promise.all([
      prisma.user.findUnique({ where: { id: sessionUser.id } }),
      getJellyfinConfig(),
      getIntegrationConfigRecord("tmdb"),
    ]);
    if (!user) return notFound("User not found");
    const tmdb = tmdbIntegration?.enabled
      ? normalizeTmdbConfig(tmdbIntegration.config)
      : null;
    return ok({
      user: {
        id: user.id,
        name: user.name || user.firstName || user.email,
        is_admin: user.isAdmin ?? false,
      },
      jellyfin: jellyfin
        ? { url: jellyfin.website_url, linked: !!user.jellyfinUserId }
        : null,
      tmdb: tmdb ? { key: tmdb.api_key } : null,
    });
  })
  // Approves a Quick Connect code the TV started on Jellyfin, for the Jellyfin
  // user linked to this account, so the TV signs in without a Jellyfin password.
  .post(
    "/jellyfin/quick-connect",
    requireUser,
    jsonV(z.object({ code: z.string().min(1).max(32) })),
    async (c) => {
      const config = await getJellyfinConfig();
      if (!config) {
        return serviceUnavailable("Jellyfin integration is not configured");
      }
      const user = await prisma.user.findUnique({
        where: { id: c.get("user").id },
      });
      if (!user?.jellyfinUserId) {
        return forbidden(
          "This account is not linked to a Jellyfin user. Ask an admin to link it.",
        );
      }
      let result: Awaited<ReturnType<typeof authorizeJellyfinQuickConnect>>;
      try {
        result = await authorizeJellyfinQuickConnect(
          config,
          c.req.valid("json").code,
          user.jellyfinUserId,
        );
      } catch (error) {
        console.error("[tv] Quick Connect authorize failed:", error);
        return badGateway("Failed to reach Jellyfin");
      }
      if (result === "unknown_code") {
        return notFound("Jellyfin does not know this Quick Connect code");
      }
      return ok({ ok: true });
    },
  );
