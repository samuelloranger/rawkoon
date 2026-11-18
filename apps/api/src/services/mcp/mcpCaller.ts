import { prisma } from "@rawkoon/api/db";
import type { MappedUser } from "@rawkoon/api/honoEnv";
import { mapUser } from "@rawkoon/api/utils/mappers";

/**
 * The acting user for an MCP key: its owner (referenceId). Kept in a service
 * because routes must not import the DB client directly.
 */
export async function findUserById(id: string): Promise<MappedUser | null> {
  const row = await prisma.user.findUnique({ where: { id } });
  return row ? mapUser(row) : null;
}
