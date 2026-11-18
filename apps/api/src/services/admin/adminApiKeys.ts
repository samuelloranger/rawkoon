import { prisma } from "@rawkoon/api/db";
import { apiKeyApi } from "@rawkoon/api/lib/apiKeyApi";
import type { McpScope } from "@rawkoon/shared/types";
import { parseMcpScopes } from "@rawkoon/api/services/mcp/mcpScopes";

const SECONDS_PER_DAY = 60 * 60 * 24;

export function listApiKeys() {
  return prisma.baApiKey.findMany({ orderBy: { createdAt: "desc" } });
}

export async function deleteApiKey(id: string) {
  await prisma.baApiKey.delete({ where: { id } });
}

export type CreateApiKeyResult =
  | { status: "duplicate" }
  | { status: "failed" }
  | {
      status: "created";
      key: string;
      row: NonNullable<Awaited<ReturnType<typeof findApiKeyById>>>;
    };

function findApiKeyById(id: string) {
  return prisma.baApiKey.findUnique({ where: { id } });
}

export async function createApiKey(
  name: string,
  days: number | undefined,
  headers: Headers,
  mcpScopes: McpScope[] = [],
): Promise<CreateApiKeyResult> {
  const existing = await prisma.baApiKey.findFirst({ where: { name } });
  if (existing) return { status: "duplicate" };

  // Owned by the acting admin; the plugin generates and hashes the key.
  // `permissions` is server-only in the plugin: passing it through the
  // header-carrying create call throws SERVER_ONLY_PROPERTY, so scopes are
  // applied right after through the same server-only update path as
  // updateApiKeyScopes.
  const created = await apiKeyApi.createApiKey({
    body: { name, expiresIn: days ? days * SECONDS_PER_DAY : null },
    headers,
  });

  if (mcpScopes.length > 0) {
    const row = await findApiKeyById(created.id);
    if (!row) {
      await rollbackCreatedKey(created.id);
      return { status: "failed" };
    }
    try {
      await apiKeyApi.updateApiKey({
        body: {
          keyId: created.id,
          userId: row.referenceId,
          permissions: { mcp: mcpScopes },
        },
      });
    } catch (error) {
      console.error("Error applying MCP scopes to the new API key:", error);
      await rollbackCreatedKey(created.id);
      return { status: "failed" };
    }
  }

  const row = await findApiKeyById(created.id);
  if (!row) return { status: "failed" };
  return { status: "created", key: created.key, row };
}

/**
 * The caller asked for a scoped key: if the scopes could not be applied, an
 * unscoped leftover would be a silent permission downgrade, so delete it.
 */
async function rollbackCreatedKey(id: string): Promise<void> {
  await prisma.baApiKey.delete({ where: { id } }).catch((err) => {
    console.error("Error rolling back the created API key:", err);
  });
}

export type UpdateScopesResult =
  | { status: "not_found" }
  | {
      status: "updated";
      row: NonNullable<Awaited<ReturnType<typeof findApiKeyById>>>;
    };

/** Replaces the key's MCP scopes while preserving any other permission resources. */
export async function updateApiKeyScopes(
  id: string,
  mcpScopes: McpScope[],
): Promise<UpdateScopesResult> {
  const row = await findApiKeyById(id);
  if (!row) return { status: "not_found" };

  // Other resources stay untouched; an empty scopes list removes the mcp entry
  // entirely, turning the key back into a plain service key.
  const otherEntries = (() => {
    if (typeof row.permissions !== "string") return {};
    try {
      const parsed = JSON.parse(row.permissions) as Record<string, unknown>;
      if (typeof parsed === "object" && parsed !== null) {
        const { mcp: _mcp, ...rest } = parsed;
        return rest;
      }
    } catch {
      // Unparseable legacy column: replace it wholesale rather than fail.
    }
    return {};
  })();

  const permissions = {
    ...otherEntries,
    ...(mcpScopes.length > 0 ? { mcp: mcpScopes } : {}),
  };

  // The plugin's own update path (server-only call; userId is the owner
  // passthrough it authorizes against), so the column stays in its format.
  await apiKeyApi.updateApiKey({
    body: { keyId: id, userId: row.referenceId, permissions },
  });

  const updated = await findApiKeyById(id);
  if (!updated) return { status: "not_found" };
  return { status: "updated", row: updated };
}
