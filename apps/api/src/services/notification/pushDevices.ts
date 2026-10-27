import { prisma } from "@rawkoon/api/db";

export const listWebPushDevices = (userId: string) =>
  prisma.userSubscription.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });

export async function deleteWebPushDevice(
  userId: string,
  id: number,
): Promise<"not_found" | "ok"> {
  const device = await prisma.userSubscription.findFirst({
    where: { id, userId },
  });
  if (!device) return "not_found";
  await prisma.userSubscription.delete({ where: { id } });
  return "ok";
}

export type WebPushDeviceInfo = {
  deviceName: string | null;
  osName: string;
  osVersion: string | null;
  browserName: string;
  browserVersion: string | null;
  platform: string | null;
};

// Returns true when the endpoint was not registered for this user before.
export async function saveWebPushSubscription(
  userId: string,
  subscription: { endpoint: string },
  device: WebPushDeviceInfo,
): Promise<boolean> {
  const endpoint = subscription.endpoint;
  const existing = await prisma.userSubscription.findFirst({
    where: { userId, endpoint },
  });

  const now = new Date().toISOString();
  const subscriptionInfo = JSON.stringify(subscription);

  if (existing) {
    await prisma.userSubscription.update({
      where: { id: existing.id },
      data: { subscriptionInfo, updatedAt: now, ...device },
    });
    return false;
  }

  await prisma.userSubscription.create({
    data: {
      userId,
      subscriptionInfo,
      endpoint,
      ...device,
      createdAt: now,
      updatedAt: now,
    },
  });
  return true;
}

export const removeWebPushSubscription = (userId: string, endpoint: string) =>
  prisma.userSubscription.deleteMany({ where: { userId, endpoint } });

export type ApnsRegistration = {
  deviceToken: string;
  deviceName: string | null;
  osVersion: string | null;
  appVersion: string | null;
  bundleId: string | null;
};

export async function registerApnsDevice(
  userId: string,
  device: ApnsRegistration,
): Promise<void> {
  const data = { userId, ...device, updatedAt: new Date() };
  // An APNs token identifies an app installation, not an account, so it
  // must belong to exactly one user. Without the delete, signing out and
  // signing in as someone else leaves the previous user's row in place
  // and their notifications keep arriving on a device that now belongs to
  // somebody else.
  await prisma.$transaction([
    prisma.apnsDevice.deleteMany({
      where: { deviceToken: device.deviceToken, userId: { not: userId } },
    }),
    prisma.apnsDevice.upsert({
      where: {
        userId_deviceToken: { userId, deviceToken: device.deviceToken },
      },
      update: data,
      create: data,
    }),
  ]);
}

export const unregisterApnsDevice = (userId: string, deviceToken: string) =>
  prisma.apnsDevice.deleteMany({ where: { userId, deviceToken } });

export const listApnsDevices = (userId: string) =>
  prisma.apnsDevice.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
  });

export async function deleteApnsDevice(
  userId: string,
  id: number,
): Promise<"not_found" | "ok"> {
  const device = await prisma.apnsDevice.findFirst({ where: { id, userId } });
  if (!device) return "not_found";
  await prisma.apnsDevice.delete({ where: { id } });
  return "ok";
}
