import { Hono } from "hono";
import { z } from "zod";
import { prisma } from "@rawkoon/api/db";
import { auth as betterAuth } from "@rawkoon/api/lib/auth";
import { getBaseUrl } from "@rawkoon/api/config";
import { ok } from "@rawkoon/api/errors";
import type { Env } from "@rawkoon/api/honoEnv";
import { requireUser } from "@rawkoon/api/middleware/hono/auth";
import { jsonV } from "@rawkoon/api/middleware/validate";
import { hashPassword } from "@rawkoon/api/utils/password";
import { mapUser } from "@rawkoon/api/utils/mappers";
import { opaqueTokenCandidates } from "@rawkoon/api/utils/tokens";
import { validatePassword } from "@rawkoon/shared/utils";

export const publicAuthRoutes = new Hono<Env>()
  .get("/api/auth/accept-invitation", async (c) => {
    const token = c.req.query("token");
    if (!token) {
      return ok({ valid: false, error: "Token is required" }, 400);
    }

    const invitation = await prisma.invitation.findFirst({
      where: {
        token: { in: opaqueTokenCandidates(token) },
        status: "pending",
        expiresAt: { gt: new Date() },
      },
    });

    if (!invitation) {
      return ok({ valid: false, error: "Invalid or expired invitation" });
    }

    return ok({ valid: true, email: invitation.email });
  })
  // Public: tells the login screen whether this is a fresh instance with no
  // accounts yet, so it can show the first-run "create administrator" form.
  .get("/api/auth/setup-status", async () => {
    const userCount = await prisma.user.count();
    return ok({ needs_setup: userCount === 0 });
  })
  .post(
    "/api/auth/accept-invitation",
    jsonV(
      z.object({
        token: z.string(),
        password: z.string(),
        first_name: z.string().optional(),
        last_name: z.string().optional(),
      }),
    ),
    async (c) => {
      const { token, password, first_name, last_name } = c.req.valid("json");
      const [passwordValid, passwordError] = validatePassword(password);
      if (!passwordValid) {
        return ok({ error: passwordError }, 400);
      }

      const invitation = await prisma.invitation.findFirst({
        where: {
          token: { in: opaqueTokenCandidates(token) },
          status: "pending",
          expiresAt: { gt: new Date() },
        },
      });
      if (!invitation) {
        return ok({ error: "Invalid or expired invitation" }, 400);
      }

      const existingUser = await prisma.user.findUnique({
        where: { email: invitation.email },
      });
      if (existingUser) {
        return ok({ error: "An account with this email already exists" }, 400);
      }

      const passwordHash = await hashPassword(password);
      const displayName = [first_name, last_name].filter(Boolean).join(" ");
      const newUser = await prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            name: displayName || invitation.email,
            email: invitation.email,
            // See `accountLinking` in lib/auth.ts.
            emailVerified: true,
            passwordHash,
            firstName: first_name || null,
            lastName: last_name || null,
            isAdmin: invitation.isAdmin,
            locale: invitation.locale || "en",
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        });

        await tx.baAccount.create({
          data: {
            id: crypto.randomUUID(),
            accountId: invitation.email,
            providerId: "credential",
            userId: user.id,
            password: passwordHash,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        });

        await tx.invitation.update({
          where: { id: invitation.id },
          data: { status: "accepted", acceptedAt: new Date() },
        });

        return user;
      });

      // Auto-login: forward better-auth's session cookie on the 201 response.
      let setCookie: string | null = null;
      try {
        const signIn = await betterAuth.api.signInEmail({
          body: { email: invitation.email, password },
          headers: c.req.raw.headers,
          returnHeaders: true,
        });
        setCookie = signIn.headers.get("set-cookie");
      } catch (err) {
        console.error(
          "[accept-invitation] auto-login failed, user must log in manually:",
          err,
        );
      }

      const headers: Record<string, string> = {
        "content-type": "application/json",
      };
      if (setCookie) headers["set-cookie"] = setCookie;
      return new Response(JSON.stringify({ user: mapUser(newUser) }), {
        status: 201,
        headers,
      });
    },
  );

export const ssoProvidersRoute = new Hono<Env>().get(
  "/api/auth/sso-providers",
  async () => {
    const providers = await prisma.oidcProvider.findMany({
      where: { enabled: true },
      select: { slug: true, name: true, iconUrl: true },
      orderBy: { createdAt: "asc" },
    });
    return ok({
      providers: providers.map((p) => ({
        slug: p.slug,
        name: p.name,
        icon_url: p.iconUrl ?? null,
      })),
    });
  },
);

// Native app OAuth bridge.
//
// A native app can't share a browser cookie jar with a URLSession POST, so it
// can't drive better-auth's POST-based OAuth start directly (the PKCE `state`
// cookie would be set in the wrong context). Instead the app opens
// `/api/mobile/oauth-start` in an ASWebAuthenticationSession: this endpoint
// makes the POST server-side, forwards better-auth's state cookie to the
// browser, and 302s to the provider. After the provider round-trip better-auth
// lands on `/api/mobile/auth-callback`, which reads the freshly-established
// session and hands the app a bearer token via the `rawkoon://` scheme.
export const mobileAuthRoutes = new Hono<Env>()
  .get("/api/mobile/oauth-start", async (c) => {
    const provider = String(c.req.query("provider") ?? "");
    if (!provider) {
      return new Response(JSON.stringify({ error: "provider required" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }
    const base = getBaseUrl();
    const initRes = await betterAuth.handler(
      // better-auth 1.7 folded generic OAuth into the social flow:
      // /sign-in/oauth2 { providerId } -> /sign-in/social { provider }.
      new Request(`${base}/api/auth/sign-in/social`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          // better-auth requires an Origin it trusts for OAuth start.
          origin: base,
          cookie: c.req.raw.headers.get("cookie") ?? "",
        },
        body: JSON.stringify({
          provider,
          callbackURL: `${base}/api/mobile/auth-callback`,
        }),
      }),
    );
    const rawBody = await initRes.text().catch(() => "");
    let data: { url?: string } = {};
    try {
      data = JSON.parse(rawBody) as { url?: string };
    } catch {
      data = {};
    }
    if (!data.url) {
      return new Response(
        JSON.stringify({
          error: "oauth_init_failed",
          upstream_status: initRes.status,
          upstream_body: rawBody.slice(0, 300),
        }),
        { status: 502, headers: { "content-type": "application/json" } },
      );
    }
    const headers = new Headers({ location: data.url });
    for (const cookie of initRes.headers.getSetCookie())
      headers.append("set-cookie", cookie);
    return new Response(null, { status: 302, headers });
  })
  .get("/api/mobile/auth-callback", async (c) => {
    let token: string | null = null;
    try {
      const session = (await betterAuth.api.getSession({
        headers: c.req.raw.headers,
      })) as {
        session?: { token?: string };
      } | null;
      token = session?.session?.token ?? null;
    } catch {
      token = null;
    }
    const location = token
      ? `rawkoon://auth?token=${encodeURIComponent(token)}`
      : `rawkoon://auth?error=nosession`;
    return new Response(null, { status: 302, headers: { location } });
  });

export const protectedAuthRoutes = new Hono<Env>().get(
  "/api/auth/me",
  requireUser,
  async (c) => {
    const user = c.get("user");
    const [dbUser, passkeyCount] = await Promise.all([
      prisma.user.findUnique({ where: { id: user.id } }),
      prisma.baPasskey.count({ where: { userId: user.id } }),
    ]);
    // A user resolved by requireUser but gone from the DB (deleted mid-request).
    if (!dbUser) return ok({ user: null }, 401);

    return ok({ user: mapUser(dbUser, { hasPasskey: passkeyCount > 0 }) });
  },
);
