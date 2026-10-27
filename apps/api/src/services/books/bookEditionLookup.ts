import { prisma } from "@rawkoon/api/db";

import type { BookEditionKind } from "@rawkoon/shared/types";

export const findBookEditionId = async (
  bookId: number,
  kind: BookEditionKind,
): Promise<number | null> => {
  const edition = await prisma.bookEdition.findUnique({
    where: { bookId_kind: { bookId, kind } },
    select: { id: true },
  });
  return edition?.id ?? null;
};
