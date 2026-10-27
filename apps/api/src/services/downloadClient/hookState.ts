import { prisma } from "@rawkoon/api/db";

export async function hasPendingDownloadForHash(
  hash: string,
): Promise<boolean> {
  const row = await prisma.downloadHistory.findFirst({
    where: { torrentHash: hash, completedAt: null, failed: false },
    select: { id: true },
  });
  return row !== null;
}

export async function stampHookSeen(): Promise<void> {
  // upsert, not update: nothing seeds media_settings row 1, so `update`
  // throws P2025 on a fresh install. See indexerManager/factory.ts:18.
  const downloadHookLastSeenAt = new Date();
  await prisma.mediaSettings.upsert({
    where: { id: 1 },
    update: { downloadHookLastSeenAt },
    create: { id: 1, downloadHookLastSeenAt },
  });
}

export async function readHookSettings() {
  const settings = await prisma.mediaSettings.findUnique({
    where: { id: 1 },
    select: {
      downloadHookCallbackUrl: true,
      downloadHookAutoConfigure: true,
      downloadHookLastSeenAt: true,
      downloadPollActiveHookedSecs: true,
    },
  });
  return {
    callbackUrl: settings?.downloadHookCallbackUrl ?? null,
    autoConfigure: settings?.downloadHookAutoConfigure ?? true,
    lastSeenAt: settings?.downloadHookLastSeenAt ?? null,
    activeHookedSecs: settings?.downloadPollActiveHookedSecs ?? 120,
  };
}

export async function saveHookSettings(input: {
  callbackUrl: string | null;
  autoConfigure: boolean;
  activeHookedSecs: number;
}): Promise<void> {
  const data = {
    downloadHookCallbackUrl: input.callbackUrl,
    downloadHookAutoConfigure: input.autoConfigure,
    downloadPollActiveHookedSecs: input.activeHookedSecs,
  };
  // upsert, not update: nothing seeds media_settings row 1.
  await prisma.mediaSettings.upsert({
    where: { id: 1 },
    update: data,
    create: { id: 1, ...data },
  });
}
