import { betterAuth, type Auth } from "better-auth";
import { genericOAuth, bearer } from "better-auth/plugins";
import { apiKey } from "@better-auth/api-key";
import { prismaAdapter } from "@better-auth/prisma-adapter";
import { passkey } from "@better-auth/passkey";
import { prisma } from "@rawkoon/api/db";
import { getBaseUrl, loadConfig } from "@rawkoon/api/config";
import { decrypt } from "@rawkoon/api/services/crypto";
import { hashPassword, verifyPassword } from "@rawkoon/api/utils/password";
import { resolveFirstSignup } from "@rawkoon/api/lib/firstSignup";

const config = loadConfig();
const authSecret = config.BETTER_AUTH_SECRET || config.SECRET_KEY;
if (
  !authSecret ||
  authSecret.length < 32 ||
  authSecret === "generate-a-random-secret-here"
) {
  console.error(
    "[rawkoon] Auth secret is invalid or not set. Generate one with:\n" +
      "  openssl rand -base64 32\n" +
      "and add it to your .env file as BETTER_AUTH_SECRET or SECRET_KEY.",
  );
  process.exit(1);
}

type OidcConfig = {
  providerId: string;
  clientId: string;
  clientSecret: string;
  discoveryUrl: string;
  scopes: string[];
  pkce: true;
  disableSignUp: true;
  mapProfileToUser: (profile: Record<string, unknown>) => {
    name: string;
    firstName: string;
    lastName: string;
  };
};

function mapProfileToUser(profile: Record<string, unknown>) {
  const name = typeof profile.name === "string" ? profile.name : "";
  const firstName =
    typeof profile.given_name === "string"
      ? profile.given_name
      : name.split(" ")[0] || "";
  const lastName =
    typeof profile.family_name === "string"
      ? profile.family_name
      : name.split(" ").slice(1).join(" ");
  return {
    name: name || [firstName, lastName].filter(Boolean).join(" "),
    firstName,
    lastName,
  };
}

async function loadOidcProviders(): Promise<OidcConfig[]> {
  try {
    const providers = await prisma.oidcProvider.findMany({
      where: { enabled: true },
    });
    return providers
      .map((p) => {
        let clientSecret = "";
        if (p.clientSecret) {
          try {
            clientSecret = decrypt(p.clientSecret);
          } catch (error) {
            // Fail closed per-provider: SECRET_KEY likely changed. Skip this
            // provider (don't take down the others) and surface the reason.
            console.error(
              `[auth] failed to decrypt client secret for OIDC provider "${p.slug}" — skipping it until re-saved: ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
            return null;
          }
        }
        if (!clientSecret) return null;
        return {
          providerId: p.slug,
          clientId: p.clientId,
          clientSecret,
          discoveryUrl: p.discoveryUrl,
          scopes: ["openid", "email", "profile"],
          pkce: true as const,
          disableSignUp: true as const,
          mapProfileToUser,
        };
      })
      .filter((c): c is OidcConfig => c !== null);
  } catch (error) {
    console.error("[auth] Failed to load OIDC providers:", error);
    return [];
  }
}

const oidcProviderConfigs: OidcConfig[] = await loadOidcProviders();

export function refreshOidcProviders(): void {
  loadOidcProviders()
    .then((configs) => {
      oidcProviderConfigs.length = 0;
      oidcProviderConfigs.push(...configs);
    })
    .catch((err) => {
      console.error("[auth] Failed to refresh OIDC providers:", err);
    });
}

const baseURL = getBaseUrl();

export const auth = betterAuth({
  appName: "Rawkoon",
  baseURL,
  secret: authSecret,
  database: prismaAdapter(prisma, {
    provider: "postgresql",
    usePlural: false,
    transaction: true,
  }),
  user: {
    modelName: "User",
    fields: {
      image: "avatarUrl",
    },
    additionalFields: {
      firstName: { type: "string", required: false, fieldName: "firstName" },
      lastName: { type: "string", required: false, fieldName: "lastName" },
      isAdmin: { type: "boolean", required: false, fieldName: "isAdmin" },
      locale: { type: "string", required: false, fieldName: "locale" },
    },
  },
  session: {
    modelName: "BaSession",
    expiresIn: 30 * 24 * 60 * 60,
    updateAge: 24 * 60 * 60,
    cookieCache: { enabled: true, maxAge: 5 * 60 },
  },
  account: {
    modelName: "BaAccount",
  },
  verification: {
    modelName: "BaVerification",
  },
  emailAndPassword: {
    enabled: true,
    // Sign-up stays reachable but is gated by the user.create hook below: only
    // the first account (empty database) is allowed through, and it becomes the
    // administrator. Every later sign-up is rejected there.
    disableSignUp: false,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url }) => {
      // Never log the reset URL/token outside local development: it grants
      // account takeover to anyone with log access (token valid for 1h). A real
      // deployment should deliver this via an email/notification transport.
      if (config.NODE_ENV === "development") {
        console.log(
          `[auth] Password reset requested for ${user.email}. URL: ${url}`,
        );
      } else {
        console.warn(
          `[auth] Password reset requested for ${user.email}, but no delivery ` +
            `transport is configured; the reset link was not sent.`,
        );
      }
    },
    resetPasswordTokenExpiresIn: 60 * 60,
    password: {
      hash: hashPassword,
      verify: ({ hash, password }) => verifyPassword(password, hash),
    },
  },
  plugins: [
    bearer(),
    apiKey({
      // App-level service tokens (e.g. Labby). Default x-api-key header.
      schema: { apikey: { modelName: "BaApiKey" } },
      rateLimit: {
        enabled: false,
      },
    }),
    passkey({
      rpID: process.env.WEBAUTHN_RP_ID || new URL(baseURL).hostname,
      rpName: process.env.WEBAUTHN_RP_NAME || "Rawkoon",
      origin: baseURL,
      schema: {
        passkey: { modelName: "BaPasskey" },
      },
    }),
    genericOAuth({ config: oidcProviderConfigs }),
  ],
  trustedOrigins: [process.env.CORS_ORIGIN || "http://localhost:5173", baseURL],
  databaseHooks: {
    user: {
      create: {
        // First account through better-auth becomes admin; later public
        // sign-ups are rejected. Admin-created users use a direct Prisma write
        // (adminUserRoutes) and never reach this hook.
        before: async (user) => {
          const existingUserCount = await prisma.user.count();
          return resolveFirstSignup(user, existingUserCount);
        },
      },
    },
    account: {
      create: {
        // Better Auth stores the credential password on the account row; the
        // app mirrors it in User.passwordHash (read by the profile password
        // change route). Backfill it when a credential account is created via
        // sign-up. Admin-created users write both columns directly and never
        // reach this hook.
        after: async (account) => {
          if (account.providerId !== "credential" || !account.password) return;
          await prisma.user
            .update({
              where: { id: account.userId },
              data: { passwordHash: account.password },
            })
            .catch((err) => {
              console.error(
                "[auth] failed to backfill User.passwordHash after sign-up:",
                err,
              );
            });
        },
      },
    },
    session: {
      create: {
        after: async (session, ctx) => {
          if (!ctx?.path) return;
          let providerId: string | null = null;
          if (ctx.path === "/sign-in/email") {
            providerId = "credential";
          } else if (ctx.path.startsWith("/oauth2/callback/")) {
            const params = (ctx as { params?: { providerId?: string } }).params;
            providerId =
              params?.providerId ??
              ctx.path.split("/oauth2/callback/")[1] ??
              null;
          }
          if (providerId) {
            await prisma.baSession
              .update({
                where: { id: session.id },
                data: { providerId },
              })
              .catch(() => {
                // Non-fatal: session exists, provider tracking is best-effort
              });
          }
        },
      },
    },
  },
  advanced: {
    database: {
      generateId: "uuid",
    },
  },
}) as unknown as Auth;
