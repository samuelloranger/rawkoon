import { prisma } from "@rawkoon/api/db";

/** Newest blocklist entries returned to the admin blocklist screen. */
const BLOCKLIST_LIMIT = 500;

export type BlocklistSource = "auto" | "manual";

export function listBlocklistEntries(source: BlocklistSource | undefined) {
  return prisma.grabBlocklist.findMany({
    where:
      source === "auto"
        ? { kind: { not: null } }
        : source === "manual"
          ? { kind: null }
          : {},
    orderBy: { blockedAt: "desc" },
    take: BLOCKLIST_LIMIT,
  });
}

export function createBlocklistEntry(input: {
  releaseTitle: string;
  torrentHash?: string;
  indexer?: string;
  mediaId?: number;
  episodeId?: number;
  reason?: string;
}) {
  return prisma.grabBlocklist.create({
    data: {
      releaseTitle: input.releaseTitle,
      torrentHash: input.torrentHash ?? null,
      indexer: input.indexer ?? null,
      mediaId: input.mediaId ?? null,
      episodeId: input.episodeId ?? null,
      reason: input.reason ?? null,
    },
  });
}

/** Returns false when no entry has that id. */
export async function deleteBlocklistEntry(id: number): Promise<boolean> {
  const existing = await prisma.grabBlocklist.findUnique({ where: { id } });
  if (!existing) return false;
  await prisma.grabBlocklist.delete({ where: { id } });
  return true;
}
