import { useEffect, useMemo, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { AlertCircle, CheckCircle2, Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useStartMigration } from "@/features/medias/hooks/useStartMigration";
import { useMigrateStatus } from "@/features/medias/hooks/useMigrateStatus";
import { queryKeys } from "@/lib/queryKeys";
import { cn } from "@/lib/utils";
import { ArrMigrationProgress } from "./ArrMigrationProgress";
import { ArrMigrationResult } from "./ArrMigrationResult";

function CredentialInput({
  label,
  placeholder,
  type = "text",
  error,
  ...inputProps
}: {
  label: string;
  placeholder: string;
  type?: "text" | "password";
  error?: string;
} & React.ComponentProps<"input">) {
  return (
    <div className="space-y-1">
      <label className="text-[11px] font-medium text-neutral-400">
        {label}
      </label>
      <input
        type={type}
        placeholder={placeholder}
        autoComplete="off"
        className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-xs text-neutral-100 placeholder-neutral-600 focus:outline-none focus:ring-1 focus:ring-primary-500"
        {...inputProps}
      />
      {error && <p className="mt-1 text-sm text-red-400">{error}</p>}
    </div>
  );
}

export function ArrLibraryImportPanel() {
  const { t } = useTranslation("common");
  const queryClient = useQueryClient();
  const startMigration = useStartMigration();
  const status = useMigrateStatus();
  const prevStateRef = useRef(status.state);

  const arrImportSchema = useMemo(
    () =>
      z.object({
        source: z.enum(["both", "radarr", "sonarr"]),
        radarrUrl: z.string().optional(),
        radarrApiKey: z.string().optional(),
        sonarrUrl: z.string().optional(),
        sonarrApiKey: z.string().optional(),
      }),
    [],
  );

  type ArrImportFormValues = z.infer<typeof arrImportSchema>;

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<ArrImportFormValues>({
    resolver: zodResolver(arrImportSchema),
    defaultValues: {
      source: "both",
      radarrUrl: "",
      radarrApiKey: "",
      sonarrUrl: "",
      sonarrApiKey: "",
    },
  });

  // react-hook-form's watch() opts this component out of React Compiler.
  // eslint-disable-next-line react-hooks/incompatible-library
  const source = watch("source");
  const radarrUrl = watch("radarrUrl");
  const radarrApiKey = watch("radarrApiKey");
  const sonarrUrl = watch("sonarrUrl");
  const sonarrApiKey = watch("sonarrApiKey");

  const isRunning = status.state === "active" || status.state === "waiting";
  const isDone = status.state === "completed";
  const isFailed = status.state === "failed";

  const needsRadarr = source === "radarr" || source === "both";
  const needsSonarr = source === "sonarr" || source === "both";

  const canStart =
    (!needsRadarr || (radarrUrl?.trim() && radarrApiKey?.trim())) &&
    (!needsSonarr || (sonarrUrl?.trim() && sonarrApiKey?.trim()));

  const onSubmit = async (data: ArrImportFormValues) => {
    const submitNeedsRadarr =
      data.source === "radarr" || data.source === "both";
    const submitNeedsSonarr =
      data.source === "sonarr" || data.source === "both";

    try {
      await startMigration.mutateAsync({
        source: data.source,
        radarr_url: submitNeedsRadarr ? data.radarrUrl?.trim() : undefined,
        radarr_api_key: submitNeedsRadarr
          ? data.radarrApiKey?.trim()
          : undefined,
        sonarr_url: submitNeedsSonarr ? data.sonarrUrl?.trim() : undefined,
        sonarr_api_key: submitNeedsSonarr
          ? data.sonarrApiKey?.trim()
          : undefined,
      });
      toast.success(t("settings.arrImport.importStarted"));
    } catch {
      toast.error(t("settings.arrImport.importStartFailed"));
    }
  };

  useEffect(() => {
    const prev = prevStateRef.current;
    prevStateRef.current = status.state;
    if (prev !== "completed" && status.state === "completed") {
      void queryClient.invalidateQueries({ queryKey: queryKeys.library.all });
    }
  }, [status.state, queryClient]);

  return (
    <div className="bg-neutral-800 rounded-xl border border-neutral-700 overflow-hidden">
      <div className="px-5 py-3.5 border-b border-neutral-700">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-white flex items-center gap-2">
              <Download size={14} className="text-primary-500" />
              {t("settings.arrImport.title")}
            </p>
            <p className="text-xs text-neutral-400 mt-0.5">
              {t("settings.arrImport.description")}
            </p>
          </div>
          {isRunning && (
            <Loader2
              size={16}
              className="text-primary-500 animate-spin shrink-0"
            />
          )}
          {isDone && !isRunning && (
            <CheckCircle2 size={16} className="text-emerald-500 shrink-0" />
          )}
          {isFailed && (
            <AlertCircle size={16} className="text-red-500 shrink-0" />
          )}
        </div>
      </div>

      <div className="p-4 space-y-4">
        {!isRunning && !isDone && (
          <form className="space-y-3" onSubmit={handleSubmit(onSubmit)}>
            {/* Source picker */}
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-neutral-400">
                {t("settings.arrImport.sourceLabel")}
              </p>
              <div className="flex rounded-xl border border-neutral-700 overflow-hidden">
                {(["both", "radarr", "sonarr"] as const).map((s) => (
                  <Button
                    key={s}
                    type="button"
                    onClick={() => setValue("source", s)}
                    size="sm"
                    className={cn(
                      "flex-1 rounded-none text-xs capitalize",
                      source === s
                        ? "bg-primary-600 text-white hover:bg-primary-700"
                        : "bg-neutral-900 text-neutral-400 hover:bg-neutral-800",
                    )}
                  >
                    {s === "both"
                      ? t("settings.arrImport.sourceBoth")
                      : s === "radarr"
                        ? t("settings.arrImport.serviceRadarr")
                        : t("settings.arrImport.serviceSonarr")}
                  </Button>
                ))}
              </div>
            </div>

            {/* Radarr credentials */}
            {needsRadarr && (
              <div className="rounded-xl border border-neutral-700 p-3 space-y-2">
                <p className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wide">
                  {t("settings.arrImport.serviceRadarr")}
                </p>
                <CredentialInput
                  label={t("settings.arrImport.urlLabel")}
                  placeholder={t("settings.arrImport.radarrUrlPlaceholder")}
                  {...register("radarrUrl")}
                  error={errors.radarrUrl?.message}
                />
                <CredentialInput
                  label={t("settings.arrImport.apiKeyLabel")}
                  placeholder={t("settings.arrImport.apiKeyPlaceholder")}
                  type="password"
                  {...register("radarrApiKey")}
                  error={errors.radarrApiKey?.message}
                />
              </div>
            )}

            {/* Sonarr credentials */}
            {needsSonarr && (
              <div className="rounded-xl border border-neutral-700 p-3 space-y-2">
                <p className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wide">
                  {t("settings.arrImport.serviceSonarr")}
                </p>
                <CredentialInput
                  label={t("settings.arrImport.urlLabel")}
                  placeholder={t("settings.arrImport.sonarrUrlPlaceholder")}
                  {...register("sonarrUrl")}
                  error={errors.sonarrUrl?.message}
                />
                <CredentialInput
                  label={t("settings.arrImport.apiKeyLabel")}
                  placeholder={t("settings.arrImport.apiKeyPlaceholder")}
                  type="password"
                  {...register("sonarrApiKey")}
                  error={errors.sonarrApiKey?.message}
                />
              </div>
            )}

            <Button
              type="submit"
              disabled={startMigration.isPending || !canStart}
              className="w-full"
            >
              {startMigration.isPending
                ? t("settings.arrImport.starting")
                : t("settings.arrImport.startImport")}
            </Button>
          </form>
        )}

        {isRunning && status.progress && (
          <ArrMigrationProgress progress={status.progress} source={source} />
        )}

        {isDone && status.result && (
          <ArrMigrationResult
            result={status.result}
            onRunAgain={() => void handleSubmit(onSubmit)()}
          />
        )}

        {isFailed && (
          <div className="space-y-2">
            <div className="rounded-lg bg-red-900/20 border border-red-800/40 px-3 py-2 text-xs text-red-400">
              {status.error ?? t("settings.arrImport.importFailedUnknown")}
            </div>
            <Button
              type="button"
              onClick={() => void handleSubmit(onSubmit)()}
              className="w-full"
            >
              {t("settings.arrImport.retry")}
            </Button>
          </div>
        )}

        {status.state === "unknown" && !startMigration.isPending && (
          <p className="text-[10px] text-neutral-500 text-center">
            {t("settings.arrImport.noPreviousJob")}
          </p>
        )}
      </div>
    </div>
  );
}
