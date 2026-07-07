import { Elysia, t } from "elysia";
import { prisma } from "@rawkoon/api/db";
import { apiKeyApi } from "@rawkoon/api/lib/apiKeyApi";
import { badRequest, serverError } from "@rawkoon/api/errors";

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

export const adminApiKeyRoutes = new Elysia()
  .get("/api-keys", async ({ set }) => {
    try {
      const rows = await prisma.baApiKey.findMany({
        orderBy: { createdAt: "desc" },
      });
      return { api_keys: rows.map(mapApiKey) };
    } catch (error) {
      console.error("Error listing API keys:", error);
      return serverError(set, "Failed to list API keys");
    }
  })
  .post(
    "/api-keys",
    async ({ body, request, set }) => {
      const name = body.name.trim();
      if (!name) return badRequest(set, "Name is required");

      const days = body.expires_in_days;
      if (
        days !== undefined &&
        (!Number.isInteger(days) || days < 1 || days > MAX_EXPIRY_DAYS)
      ) {
        return badRequest(
          set,
          `Expiration must be a whole number of days between 1 and ${MAX_EXPIRY_DAYS}`,
        );
      }

      try {
        const existing = await prisma.baApiKey.findFirst({
          where: { name },
        });
        if (existing) {
          return badRequest(set, "An API key with this name already exists");
        }

        // Owned by the acting admin; the plugin generates and hashes the key.
        const created = await apiKeyApi.createApiKey({
          body: { name, expiresIn: days ? days * SECONDS_PER_DAY : null },
          headers: request.headers,
        });
        const row = await prisma.baApiKey.findUnique({
          where: { id: created.id },
        });
        if (!row) return serverError(set, "Failed to create API key");

        set.status = 201;
        // `key` (the plaintext) is returned exactly once and never stored.
        return { key: created.key, api_key: mapApiKey(row) };
      } catch (error) {
        if ((error as { code?: string }).code === "P2002") {
          return badRequest(set, "An API key with this name already exists");
        }
        console.error("Error creating API key:", error);
        return serverError(set, "Failed to create API key");
      }
    },
    {
      body: t.Object({
        name: t.String(),
        expires_in_days: t.Optional(t.Number()),
      }),
    },
  )
  .delete(
    "/api-keys/:id",
    async ({ params, set }) => {
      try {
        await prisma.baApiKey.delete({ where: { id: params.id } });
        return { success: true };
      } catch (error) {
        console.error("Error deleting API key:", error);
        return serverError(set, "Failed to delete API key");
      }
    },
    { params: t.Object({ id: t.String() }) },
  );
