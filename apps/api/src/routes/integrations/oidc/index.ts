import { Elysia } from "elysia";
import { z } from "zod";
import { auth } from "@rawkoon/api/auth";
import { prisma } from "@rawkoon/api/db";
import { requireAdmin } from "@rawkoon/api/middleware/auth";
import { encrypt } from "@rawkoon/api/services/crypto";
import { badRequest, notFound, serverError } from "@rawkoon/api/errors";
import { refreshOidcProviders } from "@rawkoon/api/lib/auth";
import { nowUtc } from "@rawkoon/api/utils";
import { logActivity } from "@rawkoon/api/utils/activityLogs";

const SLUG_RE = /^[a-z0-9-]+$/;

function sanitizeSlug(raw: string) {
  return raw.trim().toLowerCase();
}

export const oidcIntegrationRoutes = new Elysia({ prefix: "/oidc" })
  .use(auth)
  .use(requireAdmin)
  .get("/", async ({ set }) => {
    try {
      const providers = await prisma.oidcProvider.findMany({
        orderBy: { createdAt: "asc" },
      });
      return {
        providers: providers.map((p) => ({
          id: p.id,
          slug: p.slug,
          name: p.name,
          discovery_url: p.discoveryUrl,
          client_id: p.clientId,
          client_secret_set: Boolean(p.clientSecret),
          enabled: p.enabled,
          icon_url: p.iconUrl ?? null,
        })),
      };
    } catch {
      return serverError(set, "Failed to fetch OIDC providers");
    }
  })
  .post(
    "/",
    async ({ user, body, set }) => {
      const slug = sanitizeSlug(body.slug);
      if (!SLUG_RE.test(slug)) {
        return badRequest(
          set,
          "slug must only contain lowercase letters, numbers, and hyphens",
        );
      }

      const discoveryUrl = body.discovery_url.trim();
      if (!/^https?:\/\//.test(discoveryUrl)) {
        return badRequest(set, "discovery_url must be a valid http(s) URL");
      }

      const clientId = body.client_id.trim();
      const clientSecret = body.client_secret.trim();
      if (!clientId || !clientSecret) {
        return badRequest(set, "client_id and client_secret are required");
      }

      const existing = await prisma.oidcProvider.findUnique({
        where: { slug },
      });
      if (existing) {
        return badRequest(set, `A provider with slug "${slug}" already exists`);
      }

      try {
        const now = nowUtc();
        const provider = await prisma.oidcProvider.create({
          data: {
            slug,
            name: body.name.trim(),
            discoveryUrl,
            clientId,
            clientSecret: encrypt(clientSecret),
            enabled: body.enabled ?? true,
            iconUrl: body.icon_url?.trim() || null,
            createdAt: now,
            updatedAt: now,
          },
        });

        refreshOidcProviders();

        await logActivity({
          type: "integration_updated",
          userId: user!.id,
          payload: { integration_type: "oidc", slug },
        });

        return {
          provider: {
            id: provider.id,
            slug: provider.slug,
            name: provider.name,
            discovery_url: provider.discoveryUrl,
            client_id: provider.clientId,
            client_secret_set: true,
            enabled: provider.enabled,
            icon_url: provider.iconUrl ?? null,
          },
        };
      } catch {
        return serverError(set, "Failed to create OIDC provider");
      }
    },
    {
      body: z.object({
        slug: z.string(),
        name: z.string(),
        discovery_url: z.string(),
        client_id: z.string(),
        client_secret: z.string(),
        enabled: z.boolean().optional(),
        icon_url: z.string().optional(),
      }),
    },
  )
  .put(
    "/:id",
    async ({ user, params, body, set }) => {
      const existing = await prisma.oidcProvider.findUnique({
        where: { id: params.id },
      });
      if (!existing) return notFound(set, "OIDC provider not found");

      const discoveryUrl = body.discovery_url?.trim() ?? existing.discoveryUrl;
      if (
        body.discovery_url !== undefined &&
        !/^https?:\/\//.test(discoveryUrl)
      ) {
        return badRequest(set, "discovery_url must be a valid http(s) URL");
      }

      const clientSecret = body.client_secret?.trim()
        ? encrypt(body.client_secret.trim())
        : existing.clientSecret;

      try {
        const updated = await prisma.oidcProvider.update({
          where: { id: params.id },
          data: {
            name: body.name?.trim() ?? existing.name,
            discoveryUrl,
            clientId: body.client_id?.trim() ?? existing.clientId,
            clientSecret,
            enabled: body.enabled ?? existing.enabled,
            ...(body.icon_url !== undefined
              ? { iconUrl: body.icon_url?.trim() || null }
              : {}),
            updatedAt: nowUtc(),
          },
        });

        refreshOidcProviders();

        await logActivity({
          type: "integration_updated",
          userId: user!.id,
          payload: { integration_type: "oidc", slug: updated.slug },
        });

        return {
          provider: {
            id: updated.id,
            slug: updated.slug,
            name: updated.name,
            discovery_url: updated.discoveryUrl,
            client_id: updated.clientId,
            client_secret_set: true,
            enabled: updated.enabled,
            icon_url: updated.iconUrl ?? null,
          },
        };
      } catch {
        return serverError(set, "Failed to update OIDC provider");
      }
    },
    {
      body: z.object({
        name: z.string().optional(),
        discovery_url: z.string().optional(),
        client_id: z.string().optional(),
        client_secret: z.string().optional(),
        enabled: z.boolean().optional(),
        icon_url: z.string().optional(),
      }),
    },
  )
  .delete("/:id", async ({ user, params, set }) => {
    const existing = await prisma.oidcProvider.findUnique({
      where: { id: params.id },
    });
    if (!existing) return notFound(set, "OIDC provider not found");

    try {
      await prisma.oidcProvider.delete({ where: { id: params.id } });
      refreshOidcProviders();

      await logActivity({
        type: "integration_updated",
        userId: user!.id,
        payload: {
          integration_type: "oidc",
          slug: existing.slug,
          action: "deleted",
        },
      });

      return { success: true };
    } catch {
      return serverError(set, "Failed to delete OIDC provider");
    }
  });
