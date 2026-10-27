import { prisma } from "@rawkoon/api/db";

export async function registerLiveActivityDevice(
  installationId: string,
  userId: string,
  startToken: string,
): Promise<void> {
  const existing = await prisma.liveActivityDevice.findUnique({
    where: { installationId },
  });
  await prisma.liveActivityDevice.upsert({
    where: { installationId },
    create: { installationId, userId, startToken },
    update: {
      userId,
      startToken,
      ...(existing?.userId !== userId
        ? {
            currentJobId: null,
            activityToken: null,
            lastProgress: null,
            lastStep: null,
            lastSentAt: null,
          }
        : {}),
    },
  });
}

/** Returns how many devices matched the current activity. */
export async function setLiveActivityToken(
  installationId: string,
  userId: string,
  jobId: number,
  activityToken: string,
): Promise<number> {
  const updated = await prisma.liveActivityDevice.updateMany({
    where: { installationId, userId, currentJobId: jobId },
    data: { activityToken, lastSentAt: null },
  });
  return updated.count;
}

export async function removeLiveActivityDevices(
  installationId: string,
  userId: string,
): Promise<void> {
  await prisma.liveActivityDevice.deleteMany({
    where: { installationId, userId },
  });
}
