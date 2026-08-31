import { Elysia, t } from "elysia";
import { prisma } from "@rawkoon/api/db";
import { auth as betterAuth } from "@rawkoon/api/lib/auth";
import { getBaseUrl } from "@rawkoon/api/config";
import { requireUser, resolveUser } from "@rawkoon/api/middleware/auth";
import { hashPassword } from "@rawkoon/api/utils/password";
import { mapUser } from "@rawkoon/api/utils/mappers";
import { opaqueTokenCandidates } from "@rawkoon/api/utils/tokens";
import { validatePassword } from "@rawkoon/shared/utils";

export const auth = (app: Elysia) =>
  app.resolve(async ({ request }) => ({ user: await resolveUser(request) }));

export const publicAuthRoutes = new Elysia({ name: "auth/public" })
  .get(
    "/api/auth/accept-invitation",
    async ({ query, set }) => {
      const { token } = query;
      if (!token) {
        set.status = 400;
        return { valid: false, error: "Token is required" };
      }

      const invitation = await prisma.invitation.findFirst({
        where: {
          token: { in: opaqueTokenCandidates(token) },
          status: "pending",
          expiresAt: { gt: new Date() },
        },
      });

      if (!invitation) {
        return { valid: false, error: "Invalid or expired invitation" };
      }

      return { valid: true, email: invitation.email };
    },
    { query: t.Object({ token: t.String() }) },
  )
  // Public: tells the login screen whether this is a fresh instance with no
  // accounts yet, so it can show the first-run "create administrator" form.
  .get("/api/auth/setup-status", async () => {
    const userCount = await prisma.user.count();
    return { needs_setup: userCount === 0 };
  })
  .post(
    "/api/auth/accept-invitation",
    async ({ body, request, set }) => {
      const { token, password, first_name, last_name } = body;
      const [passwordValid, passwordError] = validatePassword(password);
      if (!passwordValid) {
        set.status = 400;
        return { error: passwordError };
      }

      const invitation = await prisma.invitation.findFirst({
        where: {
          token: { in: opaqueTokenCandidates(token) },
          status: "pending",
          expiresAt: { gt: new Date() },
        },
      });
      if (!invitation) {
        set.status = 400;
        return { error: "Invalid or expired invitation" };
      }

      const existingUser = await prisma.user.findUnique({
        where: { email: invitation.email },
      });
      if (existingUser) {
        set.status = 400;
        return { error: "An account with this email already exists" };
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

      try {
        const signIn = await betterAuth.api.signInEmail({
          body: { email: invitation.email, password },
          headers: request.headers,
          returnHeaders: true,
        });
        const setCookie = signIn.headers.get("set-cookie");
        if (setCookie) {
          set.headers["set-cookie"] = setCookie;
        }
      } catch (err) {
        console.error(
          "[accept-invitation] auto-login failed, user must log in manually:",
          err,
        );
      }

      set.status = 201;
      return { user: mapUser(newUser) };
    },
    {
      body: t.Object({
        token: t.String(),
        password: t.String(),
        first_name: t.Optional(t.String()),
        last_name: t.Optional(t.String()),
      }),
    },
  );

export const ssoProvidersRoute = new Elysia({ name: "auth/sso-providers" }).get(
  "/api/auth/sso-providers",
  async () => {
    const providers = await prisma.oidcProvider.findMany({
      where: { enabled: true },
      select: { slug: true, name: true, iconUrl: true },
      orderBy: { createdAt: "asc" },
    });
    return {
      providers: providers.map((p) => ({
        slug: p.slug,
        name: p.name,
        icon_url: p.iconUrl ?? null,
      })),
    };
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
export const mobileAuthRoutes = new Elysia({ name: "auth/mobile" })
  .get("/api/mobile/oauth-start", async ({ query, request }) => {
    const provider = String((query as Record<string, unknown>).provider ?? "");
    if (!provider) {
      return new Response(JSON.stringify({ error: "provider required" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }
    const base = getBaseUrl();
    const initRes = await betterAuth.handler(
      new Request(`${base}/api/auth/sign-in/oauth2`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: request.headers.get("cookie") ?? "",
        },
        body: JSON.stringify({
          providerId: provider,
          callbackURL: `${base}/api/mobile/auth-callback`,
        }),
      }),
    );
    const data = (await initRes.json().catch(() => ({}))) as { url?: string };
    if (!data.url) {
      return new Response(JSON.stringify({ error: "oauth_init_failed" }), {
        status: 502,
        headers: { "content-type": "application/json" },
      });
    }
    const headers = new Headers({ location: data.url });
    for (const cookie of initRes.headers.getSetCookie())
      headers.append("set-cookie", cookie);
    return new Response(null, { status: 302, headers });
  })
  .get("/api/mobile/auth-callback", async ({ request }) => {
    let token: string | null = null;
    try {
      const session = (await betterAuth.api.getSession({
        headers: request.headers,
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

export const protectedAuthRoutes = new Elysia({ name: "auth/protected" })
  .use(requireUser)
  .get("/api/auth/me", async ({ user, set }) => {
    if (!user) {
      set.status = 401;
      return { user: null };
    }

    const [dbUser, passkeyCount] = await Promise.all([
      prisma.user.findUnique({ where: { id: user.id } }),
      prisma.baPasskey.count({ where: { userId: user.id } }),
    ]);
    if (!dbUser) {
      set.status = 401;
      return { user: null };
    }

    return { user: mapUser(dbUser, { hasPasskey: passkeyCount > 0 }) };
  });
