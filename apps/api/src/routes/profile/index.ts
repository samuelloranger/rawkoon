import { Hono } from "hono";
import { prisma } from "@rawkoon/api/db";
import {
  badGateway,
  badRequest,
  conflict,
  forbidden,
  notFound,
  ok,
  unauthorized,
} from "@rawkoon/api/errors";
import type { Env } from "@rawkoon/api/honoEnv";
import { auth } from "@rawkoon/api/lib/auth";
import { jellyfinSignInBody } from "@rawkoon/api/lib/jellyfinSignInPlugin";
import { requireUser } from "@rawkoon/api/middleware/hono/auth";
import { jsonV } from "@rawkoon/api/middleware/validate";
import { copyJellyfinAvatar } from "@rawkoon/api/services/jellyfinSignIn";
import {
  authenticateJellyfinUser,
  getJellyfinConfig,
  JellyfinUnreachableError,
  jellyfinSessionWhere,
  listJellyfinUsers,
} from "@rawkoon/api/services/jellyfinUsers";

async function canUnlink(userId: string, passwordHash: string | null) {
  if (passwordHash) return true;
  return (await prisma.baPasskey.count({ where: { userId } })) > 0;
}

async function currentSessionIdOf(req: Request): Promise<string | null> {
  const session = await auth.api.getSession({ headers: req.headers });
  return session?.session.id ?? null;
}

// Mounted at /api/profile. POST takes a Jellyfin password, so the strict
// per-IP limiter covers it (middleware/rateLimitCore.ts).
export const profileRoutes = new Hono<Env>()
  .use("*", requireUser)
  .get("/jellyfin", async (c) => {
    const user = await prisma.user.findUnique({
      where: { id: c.get("user").id },
    });
    if (!user) return unauthorized();

    const linked = !!user.jellyfinUserId;
    let jellyfinName: string | null = null;
    if (linked) {
      try {
        const config = await getJellyfinConfig();
        if (config) {
          const match = (await listJellyfinUsers(config)).find(
            (u) => u.id === user.jellyfinUserId,
          );
          jellyfinName = match?.name ?? null;
        }
      } catch (error) {
        console.error("[profile] could not read the Jellyfin user:", error);
      }
    }
    return ok({
      linked,
      jellyfin_name: jellyfinName,
      can_unlink: linked && (await canUnlink(user.id, user.passwordHash)),
    });
  })
  .post("/jellyfin", jsonV(jellyfinSignInBody), async (c) => {
    const body = c.req.valid("json");
    const config = await getJellyfinConfig();
    if (!config?.sign_in_enabled) {
      return notFound("Jellyfin sign-in is not enabled");
    }

    let jellyfinUser;
    try {
      jellyfinUser = await authenticateJellyfinUser(
        config,
        body.username,
        body.password,
      );
    } catch (error) {
      if (!(error instanceof JellyfinUnreachableError)) throw error;
      console.error("[profile] Jellyfin unreachable:", error);
      return badGateway("Can't reach Jellyfin");
    }
    if (!jellyfinUser) return unauthorized("Invalid username or password");
    if (jellyfinUser.disabled)
      return forbidden("That Jellyfin user is disabled");

    const userId = c.get("user").id;
    const owner = await prisma.user.findUnique({
      where: { jellyfinUserId: jellyfinUser.id },
    });
    if (owner && owner.id !== userId) {
      return conflict("That Jellyfin user is linked to another account");
    }

    // Linking must not sign out the session that is doing it.
    const currentSessionId = await currentSessionIdOf(c.req.raw);
    try {
      // Sessions minted from a previous link must not outlive it.
      await prisma.$transaction([
        prisma.user.update({
          where: { id: userId },
          data: { jellyfinUserId: jellyfinUser.id },
        }),
        prisma.baSession.deleteMany({
          where: {
            ...jellyfinSessionWhere(userId),
            ...(currentSessionId && { id: { not: currentSessionId } }),
          },
        }),
      ]);
    } catch (error) {
      if ((error as { code?: string }).code === "P2002") {
        return conflict("That Jellyfin user is linked to another account");
      }
      throw error;
    }

    await copyJellyfinAvatar(config, jellyfinUser.id, userId);
    return ok({ jellyfin_name: jellyfinUser.name });
  })
  .delete("/jellyfin", async (c) => {
    const user = await prisma.user.findUnique({
      where: { id: c.get("user").id },
    });
    if (!user) return unauthorized();
    if (!(await canUnlink(user.id, user.passwordHash))) {
      return badRequest(
        "Add a password or a passkey before unlinking Jellyfin",
      );
    }
    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: { jellyfinUserId: null },
      }),
      prisma.baSession.deleteMany({ where: jellyfinSessionWhere(user.id) }),
    ]);
    return ok({ success: true });
  });
