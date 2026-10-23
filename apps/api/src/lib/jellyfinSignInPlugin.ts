import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { z } from "zod";
import { prisma } from "@rawkoon/api/db";
import {
  authenticateJellyfinUser,
  getJellyfinConfig,
} from "@rawkoon/api/services/jellyfinUsers";
import { resolveOrCreateJellyfinRawkoonUser } from "@rawkoon/api/services/jellyfinSignIn";

export const jellyfinSignInBody = z.object({
  username: z.string().min(1).max(256),
  password: z.string().min(1).max(1024),
});

/**
 * `POST /sign-in/jellyfin`: checks a username and password with the configured
 * Jellyfin server and opens a normal better-auth session for the linked user.
 * Clients read the outcome from the status code (404 off, 401 bad credentials,
 * 403 no access, 502 Jellyfin unreachable).
 */
export const jellyfinSignIn = () =>
  ({
    id: "jellyfin-sign-in",
    endpoints: {
      signInJellyfin: createAuthEndpoint(
        "/sign-in/jellyfin",
        { method: "POST", body: jellyfinSignInBody },
        async (ctx) => {
          const config = await getJellyfinConfig();
          if (!config?.sign_in_enabled) {
            throw new APIError("NOT_FOUND", {
              message: "Jellyfin sign-in is not enabled",
            });
          }

          let jellyfinUser;
          try {
            jellyfinUser = await authenticateJellyfinUser(
              config,
              ctx.body.username,
              ctx.body.password,
            );
          } catch (error) {
            console.error("[jellyfin-sign-in] Jellyfin unreachable:", error);
            throw new APIError("BAD_GATEWAY", {
              message: "Can't reach Jellyfin",
            });
          }
          if (!jellyfinUser) {
            throw new APIError("UNAUTHORIZED", {
              message: "Invalid username or password",
            });
          }

          const resolution = await resolveOrCreateJellyfinRawkoonUser(
            jellyfinUser,
            config,
          );
          if (resolution.status === "no_access") {
            throw new APIError("FORBIDDEN", {
              message: "This Jellyfin account can't sign in to Rawkoon",
            });
          }
          const { user } = resolution;

          const session = await ctx.context.internalAdapter.createSession(
            user.id,
            false,
          );
          if (!session) {
            throw new APIError("UNAUTHORIZED", {
              message: "Failed to create session",
            });
          }
          await setSessionCookie(ctx, {
            session,
            user: user as unknown as Parameters<
              typeof setSessionCookie
            >[1]["user"],
          });
          await prisma.user
            .update({ where: { id: user.id }, data: { lastLogin: new Date() } })
            .catch(() => {
              // Non-fatal: the session already exists.
            });

          return ctx.json({
            redirect: false,
            token: session.token,
            url: undefined,
            user: {
              id: user.id,
              email: user.email,
              name: user.name,
              image: user.avatarUrl,
            },
          });
        },
      ),
    },
  }) satisfies BetterAuthPlugin;
