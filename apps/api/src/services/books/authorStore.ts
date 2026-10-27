import { prisma } from "@rawkoon/api/db";

export const authorSelect = {
  id: true,
  googleAuthorName: true,
  sortName: true,
  imageUrl: true,
  bio: true,
  monitored: true,
  monitorFrom: true,
  monitorEditionKinds: true,
  monitorLanguages: true,
  bookQualityProfileId: true,
  lastCheckedAt: true,
  _count: { select: { bookLinks: true } },
} as const;

export type AuthorMonitoringUpdate = {
  monitored?: boolean;
  monitorFrom?: Date | null;
  monitorEditionKinds?: string[];
  monitorLanguages?: string[];
  bookQualityProfileId?: number | null;
};

export const listAuthors = () =>
  prisma.author.findMany({
    select: authorSelect,
    // Monitored first — the list's job is to show what is being watched.
    orderBy: [{ monitored: "desc" }, { sortName: "asc" }],
  });

export const searchAuthorsByName = (q: string) =>
  prisma.author.findMany({
    where: { googleAuthorName: { contains: q, mode: "insensitive" } },
    select: authorSelect,
    orderBy: [{ monitored: "desc" }, { sortName: "asc" }],
    take: 50,
  });

export const findAuthorMonitorState = (id: number) =>
  prisma.author.findUnique({
    where: { id },
    select: { id: true, monitored: true, monitorFrom: true },
  });

export const updateAuthorMonitoring = (
  id: number,
  update: AuthorMonitoringUpdate,
) =>
  prisma.author.update({
    where: { id },
    data: {
      ...(update.monitored !== undefined
        ? { monitored: update.monitored }
        : {}),
      ...(update.monitorFrom !== undefined
        ? { monitorFrom: update.monitorFrom }
        : {}),
      ...(update.monitorEditionKinds !== undefined
        ? { monitorEditionKinds: update.monitorEditionKinds }
        : {}),
      ...(update.monitorLanguages !== undefined
        ? { monitorLanguages: update.monitorLanguages }
        : {}),
      ...(update.bookQualityProfileId !== undefined
        ? { bookQualityProfileId: update.bookQualityProfileId }
        : {}),
    },
    select: authorSelect,
  });
