import type { Job } from "bullmq";
import { prisma } from "@rawkoon/api/db";
import { getIntegrationConfigRecord } from "@rawkoon/api/services/integrationConfigCache";
import { normalizeTmdbConfig } from "@rawkoon/api/utils/integrations/normalizers";
import { getGlobalTmdbRegion } from "@rawkoon/api/utils/medias/tmdbRegion";
import { migrateFromRadarr } from "@rawkoon/api/services/jobs/libraryMigrateRadarr";
import { migrateFromSonarr } from "@rawkoon/api/services/jobs/libraryMigrateSonarr";
import type {
  LibraryMigrateJobData,
  LibraryMigrateProgress,
  LibraryMigrateResult,
} from "@rawkoon/api/services/jobs/libraryMigrateTypes";

export async function processLibraryMigrateJob(
  job: Job<LibraryMigrateJobData>,
): Promise<LibraryMigrateResult> {
  const { source, radarr_url, radarr_api_key, sonarr_url, sonarr_api_key } =
    job.data;

  const tmdbIntegration = await getIntegrationConfigRecord("tmdb");
  const tmdbConfig = tmdbIntegration?.enabled
    ? normalizeTmdbConfig(tmdbIntegration.config)
    : null;

  const mediaSettings = await prisma.mediaSettings.findUnique({
    where: { id: 1 },
  });
  const defaultQualityProfileId =
    mediaSettings?.defaultQualityProfileId ?? null;
  const region = await getGlobalTmdbRegion();

  const progress: LibraryMigrateProgress = {
    phase: "radarr",
    current: 0,
    total: 0,
    current_title: null,
    radarr: {
      imported: 0,
      already_existed: 0,
      skipped: 0,
      files_scanned: 0,
      errors: 0,
    },
    sonarr: {
      imported_shows: 0,
      imported_episodes: 0,
      imported_files: 0,
      files_scanned: 0,
      errors: 0,
    },
  };

  const result: LibraryMigrateResult = {};
  const push = async () => job.updateProgress(progress as unknown as object);

  const ctx = {
    tmdbConfig,
    defaultQualityProfileId,
    region,
    progress,
    result,
    push,
  };

  if (source === "radarr" || source === "both") {
    if (!radarr_url || !radarr_api_key) {
      result.radarr = {
        imported: 0,
        already_existed: 0,
        skipped: 0,
        files_scanned: 0,
        errors: ["Radarr URL and API key are required"],
      };
    } else {
      await migrateFromRadarr(radarr_url, radarr_api_key, ctx);
    }
  }

  if (source === "sonarr" || source === "both") {
    if (!sonarr_url || !sonarr_api_key) {
      result.sonarr = {
        imported_shows: 0,
        imported_episodes: 0,
        imported_files: 0,
        files_scanned: 0,
        errors: ["Sonarr URL and API key are required"],
      };
    } else {
      await migrateFromSonarr(sonarr_url, sonarr_api_key, ctx);
    }
  }

  progress.phase = "done";
  progress.current_title = null;
  await push();

  return result;
}
