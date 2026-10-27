import { prisma } from "@rawkoon/api/db";
import { listKnownIndexers } from "@rawkoon/api/services/seeding/indexerPrivacy";
import { indexerKey } from "@rawkoon/api/services/seeding/seedPolicy";
import { loadSeedContext } from "@rawkoon/api/services/seeding/seedSweep";
import { buildSeedRuleRows } from "@rawkoon/api/services/seeding/seedingView";

export async function loadSeedRuleRows() {
  const [indexers, overrides, ctx, held] = await Promise.all([
    listKnownIndexers(),
    prisma.indexerSeedRule.findMany(),
    loadSeedContext(),
    prisma.downloadHistory.findMany({
      where: {
        completedAt: { not: null },
        failed: false,
        seedReleasedAt: null,
        torrentHash: { not: null },
      },
      select: { indexer: true, torrentHash: true },
      distinct: ["torrentHash"],
    }),
  ]);
  const heldByIndexer = new Map<string, number>();
  for (const h of held) {
    const key = indexerKey(h.indexer);
    if (key) heldByIndexer.set(key, (heldByIndexer.get(key) ?? 0) + 1);
  }
  return buildSeedRuleRows(indexers, overrides, heldByIndexer, ctx);
}

export async function saveSeedRule(
  name: string,
  rule: { ratio: number | null; seed_time_mins: number | null },
) {
  const existing = await prisma.indexerSeedRule.findFirst({
    where: { indexerName: { equals: name, mode: "insensitive" } },
  });
  const data = { ratio: rule.ratio, seedTimeMins: rule.seed_time_mins };
  // Upsert so two concurrent first saves can't both hit the unique constraint.
  return prisma.indexerSeedRule.upsert({
    where: { indexerName: existing?.indexerName ?? name },
    update: data,
    create: { indexerName: name, ...data },
  });
}

export async function deleteSeedRules(name: string): Promise<number> {
  const res = await prisma.indexerSeedRule.deleteMany({
    where: { indexerName: { equals: name, mode: "insensitive" } },
  });
  return res.count;
}
