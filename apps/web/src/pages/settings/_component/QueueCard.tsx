import { useState } from "react";
import { toast } from "sonner";
import { useRetryJob } from "@/pages/settings/useRetryJob";
import { useRetryFailed } from "@/pages/settings/useRetryFailed";
import { useCleanQueue } from "@/pages/settings/useCleanQueue";
import type { QueueStat, QueueJob } from "@rawkoon/shared/types";
import { ADMIN_ENDPOINTS } from "@/lib/endpoints";
import { useFetcher } from "@/lib/api/context";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import { useConfirm } from "@/components/confirm/ConfirmContext";
import {
  ChevronDown,
  ChevronRight,
  RotateCcw,
  Trash2,
  AlertCircle,
  CheckCircle2,
  Clock,
  Loader2,
  Timer,
} from "lucide-react";
import { getStatusColor, formatDuration, timeAgo } from "./jobsUtils";

// ---------------------------------------------------------------------------
// Queue name display mapping
// ---------------------------------------------------------------------------

const QUEUE_NAME_TO_SLUG: Record<string, string> = {
  "Scheduled Tasks": "scheduled-tasks",
  Notifications: "notifications",
  "Activity Logs": "activity-logs",
  Default: "default",
  "Library Migrate": "library-migrate",
};

// ---------------------------------------------------------------------------
// Queue Job Row
// ---------------------------------------------------------------------------

function QueueJobRow({
  job,
  onRetry,
  t,
}: {
  job: QueueJob;
  onRetry: (jobId: string) => void;
  t: (key: string) => string;
}) {
  const [showTrace, setShowTrace] = useState(false);
  const duration =
    job.finishedOn && job.processedOn
      ? new Date(job.finishedOn).getTime() - new Date(job.processedOn).getTime()
      : null;

  return (
    <div className="border border-neutral-700 rounded-md p-3 bg-neutral-800/50 text-xs">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-medium text-neutral-100 truncate">
              {job.name}
            </span>
            <span
              className={`px-1.5 py-0.5 rounded-full text-[10px] uppercase font-bold ${getStatusColor(job.status)}`}
            >
              {job.status}
            </span>
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-neutral-400">
            {job.timestamp && (
              <span>
                {timeAgo(job.timestamp)} {t("settings.jobs.history.ago")}
              </span>
            )}
            {duration !== null && (
              <span>
                {t("settings.jobs.queues.duration")} {formatDuration(duration)}
              </span>
            )}
            {job.attemptsMade > 0 && (
              <span>
                {t("settings.jobs.queues.attempts")} {job.attemptsMade}
              </span>
            )}
          </div>
          {job.failedReason && (
            <div className="mt-1.5">
              <p className="text-red-400 break-all">
                {t("settings.jobs.queues.failedReason")} {job.failedReason}
              </p>
              {job.stacktrace?.length > 0 && (
                <button
                  onClick={() => setShowTrace(!showTrace)}
                  className="mt-1 text-neutral-500 hover:text-neutral-300 underline"
                >
                  {t("settings.jobs.queues.stacktrace")}
                </button>
              )}
              {showTrace && (
                <pre className="mt-1 p-2 bg-neutral-900 rounded text-[10px] overflow-x-auto max-h-40 overflow-y-auto whitespace-pre-wrap">
                  {job.stacktrace.join("\n")}
                </pre>
              )}
            </div>
          )}
        </div>
        {job.status === "failed" && (
          <button
            onClick={() => onRetry(job.id)}
            className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-blue-400 bg-blue-900/20 border border-blue-800 rounded hover:bg-blue-900/30 transition-colors shrink-0"
          >
            <RotateCcw className="size-3" />
            {t("settings.jobs.queues.retryJob")}
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Queue Card with inline accordion
// ---------------------------------------------------------------------------

export function QueueCard({
  stat,
  t,
}: {
  stat: QueueStat;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  const fetcher = useFetcher();
  const { confirm } = useConfirm();
  const [expanded, setExpanded] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("failed");
  const queueSlug = QUEUE_NAME_TO_SLUG[stat.name] ?? stat.name;

  const { mutateAsync: retryFailed, isPending: retryingAll } = useRetryFailed();
  const { mutateAsync: cleanQueue, isPending: cleaning } = useCleanQueue();
  const { mutateAsync: retryJob } = useRetryJob();

  const {
    data: queueJobs,
    isLoading: jobsLoading,
    refetch,
  } = useQuery({
    queryKey: queryKeys.admin.queueJobs(queueSlug, statusFilter),
    queryFn: () =>
      fetcher<QueueJob[]>(
        `${ADMIN_ENDPOINTS.QUEUE_JOBS(queueSlug)}?status=${statusFilter}&limit=30`,
      ),
    enabled: expanded,
    refetchInterval: expanded ? 5000 : false,
  });

  const handleRetryAll = async () => {
    confirm({
      variant: "default",
      description: t("settings.jobs.queues.retryAllConfirm", {
        queue: stat.name,
      }),
      confirmLabel: t("settings.jobs.queues.retryAll"),
      onConfirm: async () => {
        try {
          const result = await retryFailed(queueSlug);
          toast.success(
            t("settings.jobs.queues.retrySuccess", { count: result.retried }),
          );
        } catch {
          toast.error(t("settings.jobs.error"));
        }
      },
    });
  };

  const handleClean = async (status: "completed" | "failed") => {
    confirm({
      variant: "destructive",
      description: t("settings.jobs.queues.cleanConfirm", {
        status,
        queue: stat.name,
      }),
      confirmLabel: t("settings.jobs.queues.clean"),
      onConfirm: async () => {
        try {
          const result = await cleanQueue({ queue: queueSlug, status });
          toast.success(
            t("settings.jobs.queues.cleanSuccess", { count: result.cleaned }),
          );
        } catch {
          toast.error(t("settings.jobs.error"));
        }
      },
    });
  };

  const handleRetryJob = async (jobId: string) => {
    try {
      await retryJob({ queue: queueSlug, jobId });
      toast.success(t("settings.jobs.queues.retryJobSuccess"));
      refetch();
    } catch {
      toast.error(t("settings.jobs.error"));
    }
  };

  const total =
    stat.waiting + stat.active + stat.completed + stat.failed + stat.delayed;

  const statusFilters = [
    { key: "failed", label: t("settings.jobs.queues.filterFailed") },
    { key: "active", label: t("settings.jobs.queues.filterActive") },
    { key: "waiting", label: t("settings.jobs.queues.filterWaiting") },
    { key: "completed", label: t("settings.jobs.queues.filterCompleted") },
  ];

  return (
    <div className="border border-neutral-700 rounded-lg bg-neutral-900/50 overflow-hidden">
      {/* Card header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-4 text-left hover:bg-neutral-800/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          {expanded ? (
            <ChevronDown className="size-4 text-neutral-500" />
          ) : (
            <ChevronRight className="size-4 text-neutral-500" />
          )}
          <div>
            <h4 className="font-medium text-neutral-100">{stat.name}</h4>
            <p className="text-xs text-neutral-500 mt-0.5">
              {t("settings.jobs.queues.totalJobs", { count: total })}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {stat.active > 0 && (
            <span className="flex items-center gap-1 text-xs font-medium text-blue-400">
              <Loader2 className="size-3 animate-spin" />
              {stat.active}
            </span>
          )}
          {stat.waiting > 0 && (
            <span className="flex items-center gap-1 text-xs font-medium text-amber-400">
              <Clock className="size-3" />
              {stat.waiting}
            </span>
          )}
          {stat.failed > 0 && (
            <span className="flex items-center gap-1 text-xs font-medium text-red-400">
              <AlertCircle className="size-3" />
              {stat.failed}
            </span>
          )}
          {stat.completed > 0 && (
            <span className="flex items-center gap-1 text-xs font-medium text-green-400">
              <CheckCircle2 className="size-3" />
              {stat.completed}
            </span>
          )}
          {stat.delayed > 0 && (
            <span className="flex items-center gap-1 text-xs font-medium text-purple-400">
              <Timer className="size-3" />
              {stat.delayed}
            </span>
          )}
        </div>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-neutral-700 p-4 space-y-3">
          {/* Action buttons */}
          <div className="flex flex-wrap gap-2">
            {stat.failed > 0 && (
              <button
                onClick={handleRetryAll}
                disabled={retryingAll}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-400 bg-red-900/20 border border-red-800 rounded-md hover:bg-red-900/30 disabled:opacity-50 transition-colors"
              >
                <RotateCcw className="size-3" />
                {t("settings.jobs.queues.retryAll")}
              </button>
            )}
            {stat.completed > 0 && (
              <button
                onClick={() => handleClean("completed")}
                disabled={cleaning}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-neutral-400 bg-neutral-800 border border-neutral-700 rounded-md hover:bg-neutral-700 disabled:opacity-50 transition-colors"
              >
                <Trash2 className="size-3" />
                {t("settings.jobs.queues.cleanCompleted")}
              </button>
            )}
            {stat.failed > 0 && (
              <button
                onClick={() => handleClean("failed")}
                disabled={cleaning}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-neutral-400 bg-neutral-800 border border-neutral-700 rounded-md hover:bg-neutral-700 disabled:opacity-50 transition-colors"
              >
                <Trash2 className="size-3" />
                {t("settings.jobs.queues.cleanFailed")}
              </button>
            )}
          </div>

          {/* Status filter tabs */}
          <div className="flex gap-1 bg-neutral-800 rounded-md p-0.5">
            {statusFilters.map((f) => (
              <button
                key={f.key}
                onClick={() => setStatusFilter(f.key)}
                className={`flex-1 px-2 py-1 text-xs font-medium rounded transition-colors ${
                  statusFilter === f.key
                    ? "bg-neutral-700 text-neutral-100 shadow-sm"
                    : "text-neutral-500 hover:text-neutral-300"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* Job list */}
          {jobsLoading ? (
            <div className="py-4 text-center text-sm text-neutral-500">
              <Loader2 className="size-4 animate-spin mx-auto mb-1" />
            </div>
          ) : !queueJobs?.length ? (
            <p className="py-3 text-center text-xs text-neutral-500">
              {t("settings.jobs.queues.noJobs")}
            </p>
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {queueJobs.map((job) => (
                <QueueJobRow
                  key={job.id}
                  job={job}
                  onRetry={handleRetryJob}
                  t={t}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
