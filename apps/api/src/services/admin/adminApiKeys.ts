import { prisma } from "@rawkoon/api/db";
import { apiKeyApi } from "@rawkoon/api/lib/apiKeyApi";

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
): Promise<CreateApiKeyResult> {
  const existing = await prisma.baApiKey.findFirst({ where: { name } });
  if (existing) return { status: "duplicate" };

  // Owned by the acting admin; the plugin generates and hashes the key.
  const created = await apiKeyApi.createApiKey({
    body: { name, expiresIn: days ? days * SECONDS_PER_DAY : null },
    headers,
  });
  const row = await findApiKeyById(created.id);
  if (!row) return { status: "failed" };
  return { status: "created", key: created.key, row };
}
