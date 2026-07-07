import { useTranslation } from "react-i18next";
import type { MigrateJobResult } from "@rawkoon/shared/types";
import { Button } from "@/components/ui/button";

interface ArrMigrationResultProps {
  result: MigrateJobResult;
  onRunAgain: () => void;
}

export function ArrMigrationResult({
  result,
  onRunAgain,
}: ArrMigrationResultProps) {
  const { t } = useTranslation("common");

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-emerald-400">
        {t("settings.arrImport.importComplete")}
      </p>
      {result.radarr && (
        <div className="rounded-lg bg-neutral-800/60 px-3 py-2 text-[10px] text-neutral-400">
          <span className="font-medium text-neutral-300">
            {t("settings.arrImport.serviceRadarr")}:{" "}
          </span>
          {t("settings.arrImport.radarrResultLine", {
            imported: result.radarr.imported,
            existed: result.radarr.already_existed,
            scanned: result.radarr.files_scanned,
          })}
          {result.radarr.errors.length > 0 && (
            <span className="text-red-500">
              {" "}
              ·{" "}
              {t("settings.arrImport.errorsCount", {
                count: result.radarr.errors.length,
              })}
            </span>
          )}
        </div>
      )}
      {result.sonarr && (
        <div className="rounded-lg bg-neutral-800/60 px-3 py-2 text-[10px] text-neutral-400">
          <span className="font-medium text-neutral-300">
            {t("settings.arrImport.serviceSonarr")}:{" "}
          </span>
          {t("settings.arrImport.sonarrResultLine", {
            shows: result.sonarr.imported_shows,
            episodes: result.sonarr.imported_episodes,
            scanned: result.sonarr.files_scanned,
          })}
          {result.sonarr.errors.length > 0 && (
            <span className="text-red-500">
              {" "}
              ·{" "}
              {t("settings.arrImport.errorsCount", {
                count: result.sonarr.errors.length,
              })}
            </span>
          )}
        </div>
      )}
      <Button
        type="button"
        variant="outline"
        onClick={onRunAgain}
        className="w-full"
      >
        {t("settings.arrImport.runAgain")}
      </Button>
    </div>
  );
}
