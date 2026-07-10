import { Elysia, t } from "elysia";
import { prisma } from "@rawkoon/api/db";
import { auth as betterAuth } from "@rawkoon/api/lib/auth";
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
            emailVerified: false,
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
