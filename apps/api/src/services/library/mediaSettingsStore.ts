import { prisma } from "@rawkoon/api/db";
import {
  DEFAULT_RELEASE_CHECK_CRON,
  type RssPollIntervalMinutes,
} from "@rawkoon/shared/utils";
import { rescheduleThenPersist } from "@rawkoon/api/services/releaseCheckSchedule";
import {
  loadRssPollInterval,
  rescheduleRssPollThenPersist,
} from "@rawkoon/api/services/rss/rssPollSchedule";

export type MediaSettingsUpdate = {
  moviesLibraryPath?: string | null;
  showsLibraryPath?: string | null;
  downloadsPath?: string | null;
  fileOperation?: string;
  movieTemplate?: string;
  episodeTemplate?: string;
  minSeedRatio?: number;
  postProcessingEnabled?: boolean;
  defaultMovieQualityProfileId?: number | null;
  defaultShowQualityProfileId?: number | null;
  searchOnAdd?: boolean;
  releaseCheckCron?: string;
  rssPollIntervalMinutes?: number;
  activeIndexerManager?: string | null;
  booksLibraryPath?: string | null;
  audiobooksLibraryPath?: string | null;
  bookTemplate?: string;
  audiobookTemplate?: string;
  defaultBookQualityProfileId?: number | null;
  publicSeedTimeMins?: number | null;
  privateSeedRatio?: number | null;
  privateSeedTimeMins?: number | null;
  seedSweepEnabled?: boolean;
  blockedExtensions?: string[];
  minFreeSpaceGb?: number;
};

export async function loadOrCreateMediaSettings() {
  const row = await prisma.mediaSettings.findUnique({ where: { id: 1 } });
  return row ?? prisma.mediaSettings.create({ data: { id: 1 } });
}

/** Persists the update, rescheduling cron/RSS jobs first so a rejected schedule is never stored. */
export async function saveMediaSettings(
  update: MediaSettingsUpdate,
  rssPollInterval: RssPollIntervalMinutes | undefined,
) {
  let row = await prisma.mediaSettings.findUnique({ where: { id: 1 } });
  const previousCron = row?.releaseCheckCron ?? DEFAULT_RELEASE_CHECK_CRON;
  const existing = row;
  const persist = async () => {
    if (!existing) {
      row = await prisma.mediaSettings.create({
        data: { id: 1, ...update },
      });
    } else if (Object.keys(update).length > 0) {
      row = await prisma.mediaSettings.update({
        where: { id: 1 },
        data: update,
      });
    }
  };
  let save = persist;
  if (
    update.releaseCheckCron !== undefined &&
    update.releaseCheckCron !== previousCron
  ) {
    const cron = update.releaseCheckCron;
    // Schedule before saving so a cron BullMQ rejects is never stored.
    save = () => rescheduleThenPersist(cron, previousCron, persist);
  }
  if (rssPollInterval !== undefined) {
    const previousInterval = await loadRssPollInterval(
      async () => existing?.rssPollIntervalMinutes,
    );
    if (rssPollInterval !== previousInterval) {
      const inner = save;
      save = () =>
        rescheduleRssPollThenPersist(rssPollInterval, previousInterval, inner);
    }
  }
  await save();
  return row!;
}
