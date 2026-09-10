import { Hono } from "hono";
import { z } from "zod";
import { prisma } from "@rawkoon/api/db";
import { apiKeyApi } from "@rawkoon/api/lib/apiKeyApi";
import { badRequest, ok, serverError } from "@rawkoon/api/errors";
import type { Env } from "@rawkoon/api/honoEnv";
import { jsonV } from "@rawkoon/api/middleware/validate";

const MAX_EXPIRY_DAYS = 365;
const SECONDS_PER_DAY = 60 * 60 * 24;

type ApiKeyRow = {
  id: string;
  name: string | null;
  start: string | null;
  prefix: string | null;
  enabled: boolean;
  lastRequest: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
};

function mapApiKey(row: ApiKeyRow) {
  return {
    id: row.id,
    name: row.name,
    start: row.start,
    prefix: row.prefix,
    enabled: row.enabled,
    last_used_at: row.lastRequest?.toISOString() ?? null,
    expires_at: row.expiresAt?.toISOString() ?? null,
    created_at: row.createdAt.toISOString(),
  };
}

// Mounted under /api/admin; requireAdmin is applied at the admin parent.
export const adminApiKeyRoutes = new Hono<Env>()
  .get("/api-keys", async () => {
    try {
      const rows = await prisma.baApiKey.findMany({
        orderBy: { createdAt: "desc" },
      });
      return ok({ api_keys: rows.map(mapApiKey) });
    } catch (error) {
      console.error("Error listing API keys:", error);
      return serverError("Failed to list API keys");
    }
  })
  .post(
    "/api-keys",
    jsonV(
      z.object({
        name: z.string(),
        expires_in_days: z.number().optional(),
      }),
    ),
    async (c) => {
      const body = c.req.valid("json");
      const name = body.name.trim();
      if (!name) return badRequest("Name is required");

      const days = body.expires_in_days;
      if (
        days !== undefined &&
        (!Number.isInteger(days) || days < 1 || days > MAX_EXPIRY_DAYS)
      ) {
        return badRequest(
          `Expiration must be a whole number of days between 1 and ${MAX_EXPIRY_DAYS}`,
        );
      }

      try {
        const existing = await prisma.baApiKey.findFirst({ where: { name } });
        if (existing) {
          return badRequest("An API key with this name already exists");
        }

        // Owned by the acting admin; the plugin generates and hashes the key.
        const created = await apiKeyApi.createApiKey({
          body: { name, expiresIn: days ? days * SECONDS_PER_DAY : null },
          headers: c.req.raw.headers,
        });
        const row = await prisma.baApiKey.findUnique({
          where: { id: created.id },
        });
        if (!row) return serverError("Failed to create API key");

        // `key` (the plaintext) is returned exactly once and never stored.
        return ok({ key: created.key, api_key: mapApiKey(row) }, 201);
      } catch (error) {
        if ((error as { code?: string }).code === "P2002") {
          return badRequest("An API key with this name already exists");
        }
        console.error("Error creating API key:", error);
        return serverError("Failed to create API key");
      }
    },
  )
  .delete("/api-keys/:id", async (c) => {
    try {
      await prisma.baApiKey.delete({ where: { id: c.req.param("id") } });
      return ok({ success: true });
    } catch (error) {
      console.error("Error deleting API key:", error);
      return serverError("Failed to delete API key");
    }
  });
