import { prisma } from "@rawkoon/api/db";

type IndexerManagerType = "jackett" | "prowlarr";

/**
 * Keep media_settings.activeIndexerManager coherent after a manager is saved:
 * claim the slot when it is empty, hand it to the other manager when this one
 * is the active one and was just disabled.
 */
export async function syncActiveIndexerManager(
  type: IndexerManagerType,
  enabled: boolean,
): Promise<void> {
  const settings = await prisma.mediaSettings.findUnique({
    where: { id: 1 },
  });
  if (enabled && !settings?.activeIndexerManager) {
    await prisma.mediaSettings.upsert({
      where: { id: 1 },
      update: { activeIndexerManager: type },
      create: { id: 1, activeIndexerManager: type },
    });
  }

  if (!enabled && settings?.activeIndexerManager === type) {
    const otherType: IndexerManagerType =
      type === "jackett" ? "prowlarr" : "jackett";
    const other = await prisma.integration.findFirst({
      where: { type: otherType, enabled: true },
    });
    await prisma.mediaSettings.update({
      where: { id: 1 },
      data: { activeIndexerManager: other ? otherType : null },
    });
  }
}
