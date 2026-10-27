import { prisma } from "@rawkoon/api/db";

const WINDOW_DAYS = 30;

export async function loadJanitorStats() {
  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000);
  const groups = await prisma.grabBlocklist.groupBy({
    by: ["kind"],
    where: { blockedAt: { gte: since }, kind: { not: null } },
    _count: { _all: true },
  });
  const count = (kind: string) =>
    groups.find((g) => g.kind === kind)?._count._all ?? 0;
  return {
    days: WINDOW_DAYS,
    stalled: count("stalled"),
    malware: count("malware"),
    import_rejected: count("import_rejected"),
  };
}
