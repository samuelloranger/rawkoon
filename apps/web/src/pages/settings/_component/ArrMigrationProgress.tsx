import { useTranslation } from "react-i18next";
import type { MigrateJobProgress } from "@rawkoon/shared/types";

interface ArrMigrationProgressProps {
  progress: MigrateJobProgress;
  source: "both" | "radarr" | "sonarr";
}

export function ArrMigrationProgress({
  progress,
  source,
}: ArrMigrationProgressProps) {
  const { t } = useTranslation("common");
  const pct =
    progress.total > 0
      ? Math.round((progress.current / progress.total) * 100)
      : 0;

  const phaseLabel =
    progress.phase === "done"
      ? t("settings.arrImport.wrappingUp")
      : t("settings.arrImport.importingService", {
          service:
            progress.phase === "radarr"
              ? t("settings.arrImport.serviceRadarr")
              : t("settings.arrImport.serviceSonarr"),
        });

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <div className="flex items-center justify-between text-xs text-neutral-400">
          <span className="capitalize font-medium">{phaseLabel}</span>
          <span>
            {progress.current} / {progress.total}
          </span>
        </div>
        <div className="h-1.5 rounded-full bg-neutral-800 overflow-hidden">
          <div
            className="h-full rounded-full bg-primary-500 transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
        {progress.current_title && (
          <p className="text-[10px] text-neutral-400 truncate">
            {progress.current_title}
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 text-[10px]">
        {(source === "both" || source === "radarr") && (
          <div className="rounded-lg bg-neutral-800/60 px-2.5 py-2">
            <p className="font-semibold text-neutral-300 mb-1">
              {t("settings.arrImport.serviceRadarr")}
            </p>
            <p className="text-neutral-500">
              {t("settings.arrImport.radarrStats", {
                imported: progress.radarr.imported,
                existed: progress.radarr.already_existed,
                scanned: progress.radarr.files_scanned,
              })}
            </p>
            {progress.radarr.errors > 0 && (
              <p className="text-red-500">
                {t("settings.arrImport.errorsCount", {
                  count: progress.radarr.errors,
                })}
              </p>
            )}
          </div>
        )}
        {(source === "both" || source === "sonarr") && (
          <div className="rounded-lg bg-neutral-800/60 px-2.5 py-2">
            <p className="font-semibold text-neutral-300 mb-1">
              {t("settings.arrImport.serviceSonarr")}
            </p>
            <p className="text-neutral-500">
              {t("settings.arrImport.sonarrProgressStats", {
                shows: progress.sonarr.imported_shows,
                files: progress.sonarr.imported_files,
                scanned: progress.sonarr.files_scanned,
              })}
            </p>
            {progress.sonarr.errors > 0 && (
              <p className="text-red-500">
                {t("settings.arrImport.errorsCount", {
                  count: progress.sonarr.errors,
                })}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
