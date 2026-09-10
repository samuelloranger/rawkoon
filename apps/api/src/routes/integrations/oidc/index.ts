import { Hono } from "hono";
import { z } from "zod";
import { prisma } from "@rawkoon/api/db";
import { encrypt } from "@rawkoon/api/services/crypto";
import { badRequest, notFound, ok, serverError } from "@rawkoon/api/errors";
import type { Env } from "@rawkoon/api/honoEnv";
import { jsonV } from "@rawkoon/api/middleware/validate";
import { refreshOidcProviders } from "@rawkoon/api/lib/auth";
import { nowUtc } from "@rawkoon/api/utils";
import { logActivity } from "@rawkoon/api/utils/activityLogs";

const SLUG_RE = /^[a-z0-9-]+$/;

function sanitizeSlug(raw: string) {
  return raw.trim().toLowerCase();
}

// Mounted at /api/integrations/oidc by the parent; requireAdmin is applied there.
export const oidcIntegrationRoutes = new Hono<Env>()
  .get("/", async () => {
    try {
      const providers = await prisma.oidcProvider.findMany({
        orderBy: { createdAt: "asc" },
      });
      return ok({
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
      });
    } catch {
      return serverError("Failed to fetch OIDC providers");
    }
  })
  .post(
    "/",
    jsonV(
      z.object({
        slug: z.string(),
        name: z.string(),
        discovery_url: z.string(),
        client_id: z.string(),
        client_secret: z.string(),
        enabled: z.boolean().optional(),
        icon_url: z.string().optional(),
      }),
    ),
    async (c) => {
      const body = c.req.valid("json");
      const slug = sanitizeSlug(body.slug);
      if (!SLUG_RE.test(slug)) {
        return badRequest(
          "slug must only contain lowercase letters, numbers, and hyphens",
        );
      }

      const discoveryUrl = body.discovery_url.trim();
      if (!/^https?:\/\//.test(discoveryUrl)) {
        return badRequest("discovery_url must be a valid http(s) URL");
      }

      const clientId = body.client_id.trim();
      const clientSecret = body.client_secret.trim();
      if (!clientId || !clientSecret) {
        return badRequest("client_id and client_secret are required");
      }

      const existing = await prisma.oidcProvider.findUnique({
        where: { slug },
      });
      if (existing) {
        return badRequest(`A provider with slug "${slug}" already exists`);
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
          userId: c.get("user").id,
          payload: { integration_type: "oidc", slug },
        });

        return ok({
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
        });
      } catch {
        return serverError("Failed to create OIDC provider");
      }
    },
  )
  .put(
    "/:id",
    jsonV(
      z.object({
        name: z.string().optional(),
        discovery_url: z.string().optional(),
        client_id: z.string().optional(),
        client_secret: z.string().optional(),
        enabled: z.boolean().optional(),
        icon_url: z.string().optional(),
      }),
    ),
    async (c) => {
      const id = c.req.param("id");
      const body = c.req.valid("json");
      const existing = await prisma.oidcProvider.findUnique({
        where: { id },
      });
      if (!existing) return notFound("OIDC provider not found");

      const discoveryUrl = body.discovery_url?.trim() ?? existing.discoveryUrl;
      if (
        body.discovery_url !== undefined &&
        !/^https?:\/\//.test(discoveryUrl)
      ) {
        return badRequest("discovery_url must be a valid http(s) URL");
      }

      const clientSecret = body.client_secret?.trim()
        ? encrypt(body.client_secret.trim())
        : existing.clientSecret;

      try {
        const updated = await prisma.oidcProvider.update({
          where: { id },
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
          userId: c.get("user").id,
          payload: { integration_type: "oidc", slug: updated.slug },
        });

        return ok({
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
        });
      } catch {
        return serverError("Failed to update OIDC provider");
      }
    },
  )
  .delete("/:id", async (c) => {
    const id = c.req.param("id");
    const existing = await prisma.oidcProvider.findUnique({
      where: { id },
    });
    if (!existing) return notFound("OIDC provider not found");

    try {
      await prisma.oidcProvider.delete({ where: { id } });
      refreshOidcProviders();

      await logActivity({
        type: "integration_updated",
        userId: c.get("user").id,
        payload: {
          integration_type: "oidc",
          slug: existing.slug,
          action: "deleted",
        },
      });

      return ok({ success: true });
    } catch {
      return serverError("Failed to delete OIDC provider");
    }
  });
