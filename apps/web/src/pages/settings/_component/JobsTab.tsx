import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useScheduledJobs } from "@/pages/settings/useScheduledJobs";
import { useTriggerAction } from "@/pages/settings/useTriggerAction";
import { useLibraryHealth } from "@/pages/settings/useLibraryHealth";
import { useJobHistory } from "@/pages/settings/useJobHistory";
import { useCurrentUser } from "@/lib/auth/useAuth";
import { formatCronTrigger } from "@/lib/utils/format";
import { LoadingState } from "@/components/LoadingState";
import {
  Play,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Timer,
  Wrench,
} from "lucide-react";
import { JOBS, type JobAction, type JobConfig } from "./jobsConfig";
import { getStatusColor, formatDuration, timeAgo } from "./jobsUtils";
import { QueueCard } from "./QueueCard";
import { LibraryHealthCard } from "./LibraryHealthCard";
import { SettingsPageHeader } from "@/pages/settings/_component/SettingsPageHeader";

// ---------------------------------------------------------------------------
// Main JobsTab
// ---------------------------------------------------------------------------

export function JobsTab() {
  const { t, i18n } = useTranslation("common");
  const { data: currentUser } = useCurrentUser();
  const { data: scheduledJobsData, isLoading, error } = useScheduledJobs();
  const { data: libraryHealthData } = useLibraryHealth();
  const { data: historyData } = useJobHistory(50);
  const { mutateAsync: triggerAction } = useTriggerAction();
  const [executing, setExecuting] = useState<JobAction | null>(null);

  const jobsByName = useMemo(() => {
    const map = new Map<string, JobConfig>();
    JOBS.forEach((job) => {
      job.jobNames.forEach((name) => map.set(name, job));
    });
    return map;
  }, []);

  const handleRun = async (action: JobAction) => {
    setExecuting(action);
    try {
      const result = await triggerAction(action);
      toast.success(result.message || t("settings.jobs.success"));
    } catch (err: unknown) {
      console.error("Error running job:", err);
      toast.error(
        err instanceof Error ? err.message : t("settings.jobs.error"),
      );
    } finally {
      setExecuting(null);
    }
  };

  if (!currentUser?.is_admin) return null;

  return (
    <div
      className="animate-in fade-in slide-in-from-right-4 duration-300 space-y-6"
      key="jobs-tab"
    >
      <SettingsPageHeader
        icon={Wrench}
        title={t("settings.jobs.title")}
        description={t("settings.jobs.description")}
      />
      <div className="bg-neutral-800 rounded-xl border border-neutral-700 p-6">
        {isLoading ? (
          <LoadingState />
        ) : error ? (
          <div className="text-red-400">{t("settings.jobs.loadError")}</div>
        ) : (
          <div className="space-y-6">
            <LibraryHealthCard
              latest={libraryHealthData?.latest ?? null}
              t={t}
            />

            {/* Queue Overview */}
            {scheduledJobsData?.queues && (
              <section>
                <h3 className="text-sm font-semibold text-neutral-100 mb-3">
                  {t("settings.jobs.queues.title")}
                </h3>
                <div className="space-y-2">
                  {scheduledJobsData.queues.map((stat) => (
                    <QueueCard key={stat.name} stat={stat} t={t} />
                  ))}
                </div>
              </section>
            )}

            {/* Scheduled Jobs */}
            {scheduledJobsData?.jobs?.length ? (
              <section>
                <h3 className="text-sm font-semibold text-neutral-100 mb-3">
                  Scheduled Jobs
                </h3>
                <div className="space-y-3">
                  {scheduledJobsData.jobs.map((job) => {
                    const config = jobsByName.get(job.name);
                    const action = config?.action ?? null;
                    const JobIcon = config?.Icon ?? Timer;
                    const title = config ? t(config.labelKey) : job.name;
                    const description = config
                      ? t(config.descriptionKey)
                      : formatCronTrigger(job.trigger, i18n.language);

                    const isRunning =
                      (action !== null && executing === action) ||
                      job.status === "active";

                    return (
                      <div
                        key={job.id}
                        className="border border-neutral-700 rounded-lg p-4 bg-neutral-900/50"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1.5">
                              <JobIcon className="w-5 h-5 text-neutral-400 shrink-0" />
                              <h4 className="font-medium text-neutral-100">
                                {title}
                              </h4>
                              {job.status && (
                                <span
                                  className={`text-xs uppercase font-bold px-1.5 py-0.5 rounded-full ${getStatusColor(job.status)}`}
                                >
                                  {job.status}
                                </span>
                              )}
                            </div>
                            <p className="text-sm text-neutral-400 mb-1.5">
                              {description}
                            </p>
                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-neutral-400">
                              <span className="flex items-center gap-1.5">
                                <span className="font-semibold text-neutral-300">
                                  {t("settings.jobs.schedule")}
                                </span>
                                {formatCronTrigger(job.trigger, i18n.language)}
                              </span>
                              {job.next_run_time && (
                                <span className="flex items-center gap-1.5">
                                  <span className="font-semibold text-neutral-300">
                                    {t("settings.jobs.next")}
                                  </span>
                                  {new Date(job.next_run_time).toLocaleString()}
                                </span>
                              )}
                            </div>
                          </div>
                          <Button
                            size="sm"
                            onClick={() => action && handleRun(action)}
                            disabled={
                              !action ||
                              executing !== null ||
                              job.status === "active"
                            }
                            className="gap-1.5 shrink-0"
                          >
                            {isRunning ? (
                              <Loader2 className="size-3.5 animate-spin" />
                            ) : (
                              <Play className="size-3.5" />
                            )}
                            {isRunning
                              ? t("settings.jobs.running")
                              : t("settings.jobs.run")}
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            ) : (
              <div className="text-neutral-400">
                {t("settings.jobs.noJobs")}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Job History */}
      {historyData?.jobs && historyData.jobs.length > 0 && (
        <div className="bg-neutral-800 rounded-xl border border-neutral-700 p-6">
          <h3 className="text-sm font-semibold text-neutral-100 mb-1">
            {t("settings.jobs.history.title")}
          </h3>
          <p className="text-xs text-neutral-400 mb-4">
            {t("settings.jobs.history.description")}
          </p>
          <div className="space-y-1.5 max-h-96 overflow-y-auto">
            {historyData.jobs.map((entry) => (
              <div
                key={`${entry.queue}-${entry.id}`}
                className="flex items-center gap-3 px-3 py-2 rounded-md bg-neutral-900/50 text-xs"
              >
                {entry.status === "completed" ? (
                  <CheckCircle2 className="size-3.5 text-green-500 shrink-0" />
                ) : (
                  <AlertCircle className="size-3.5 text-red-500 shrink-0" />
                )}
                <span className="font-medium text-neutral-100 truncate min-w-0 flex-1">
                  {entry.name}
                </span>
                <span className="text-neutral-400 shrink-0">{entry.queue}</span>
                {entry.duration !== null && (
                  <span
                    className={`shrink-0 font-mono ${
                      entry.duration > 5000
                        ? "text-amber-400"
                        : "text-neutral-500"
                    }`}
                  >
                    {formatDuration(entry.duration)}
                  </span>
                )}
                {entry.finished_on && (
                  <span className="text-neutral-400 shrink-0">
                    {timeAgo(entry.finished_on)}
                  </span>
                )}
                {entry.failed_reason && (
                  <span
                    className="text-red-500 truncate max-w-40 shrink-0"
                    title={entry.failed_reason}
                  >
                    {entry.failed_reason}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
