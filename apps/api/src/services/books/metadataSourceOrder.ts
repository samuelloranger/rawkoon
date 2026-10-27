import { prisma } from "@rawkoon/api/db";

export const getStoredMetadataSourceOrder = async () => {
  const settings = await prisma.mediaSettings.findUnique({
    where: { id: 1 },
    select: { bookMetadataSourceOrder: true },
  });
  return settings?.bookMetadataSourceOrder;
};

export const saveMetadataSourceOrder = async (order: string[]) => {
  await prisma.mediaSettings.update({
    where: { id: 1 },
    data: { bookMetadataSourceOrder: order },
  });
};
