import { prisma } from "@rawkoon/api/db";
import type { BookEditionKind } from "@rawkoon/shared/types";

export const EDITION_STATUSES = [
  "wanted",
  "downloading",
  "downloaded",
  "skipped",
  "upgrading",
];

export const editionSelect = {
  id: true,
  kind: true,
  status: true,
  monitored: true,
  bookQualityProfileId: true,
  bookQualityProfile: { select: { id: true, name: true } },
  narrators: true,
  durationSecs: true,
  searchAttempts: true,
  lastGrabbedAt: true,
  totalSizeBytes: true,
  offlineReady: true,
  files: { select: { id: true, format: true } },
} as const;

export const findEditionIdByKind = (bookId: number, kind: BookEditionKind) =>
  prisma.bookEdition.findUnique({
    where: { bookId_kind: { bookId, kind } },
    select: { id: true },
  });

export const findBookQualityProfile = (id: number) =>
  prisma.bookQualityProfile.findUnique({
    where: { id },
    select: { id: true, kind: true },
  });

export const updateEdition = (
  id: number,
  data: {
    monitored?: boolean;
    status?: string;
    bookQualityProfileId?: number | null;
  },
) =>
  prisma.bookEdition.update({
    where: { id },
    data: {
      ...(data.monitored !== undefined ? { monitored: data.monitored } : {}),
      ...(data.status !== undefined ? { status: data.status } : {}),
      ...(data.bookQualityProfileId !== undefined
        ? { bookQualityProfileId: data.bookQualityProfileId }
        : {}),
    },
    select: editionSelect,
  });

export const bookExists = async (id: number): Promise<boolean> =>
  !!(await prisma.libraryBook.findUnique({
    where: { id },
    select: { id: true },
  }));

export async function createEdition(
  bookId: number,
  kind: BookEditionKind,
  opts: { monitored?: boolean; bookQualityProfileId?: number | null },
) {
  const profile =
    opts.bookQualityProfileId ??
    (
      await prisma.bookQualityProfile.findFirst({
        where: { OR: [{ kind }, { kind: "both" }] },
        select: { id: true },
        orderBy: { kind: "asc" },
      })
    )?.id ??
    null;

  return prisma.bookEdition.create({
    data: {
      bookId,
      kind,
      monitored: opts.monitored ?? true,
      bookQualityProfileId: profile,
    },
    select: editionSelect,
  });
}

export const findEditionWithFiles = (bookId: number, kind: BookEditionKind) =>
  prisma.bookEdition.findUnique({
    where: { bookId_kind: { bookId, kind } },
    include: { files: { orderBy: { fileName: "asc" } } },
  });

export async function deleteEditionFile(
  bookId: number,
  fileId: number,
): Promise<boolean> {
  const file = await prisma.bookFile.findFirst({
    where: { id: fileId, edition: { bookId } },
    select: { id: true },
  });
  if (!file) return false;
  await prisma.bookFile.delete({ where: { id: file.id } });
  return true;
}
