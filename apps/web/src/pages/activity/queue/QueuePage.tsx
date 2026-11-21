import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowDown, Clock, Film, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { formatEtaSeconds } from "@rawkoon/shared/utils";
import { useLibraryAttention } from "@/features/medias/hooks/useLibraryAttention";
import { useDismissLibraryAttentionAlert } from "@/features/medias/hooks/useDismissLibraryAttentionAlert";
import { useRetryLibraryPostProcess } from "@/features/medias/hooks/useRetryLibraryPostProcess";
import { useActiveDownloads } from "@/features/medias/hooks/useActiveDownloads";
import { useDownloadsSpeed } from "@/pages/_component/useDownloadsSpeed";
import {
  useGrabPendingNow,
  usePendingReleases,
} from "@/pages/_component/usePendingReleases";
import { formatSpeed } from "@/lib/utils/format";
import { cn } from "@/lib/utils";
import { useCurrentUser } from "@/lib/auth/useAuth";
import {
  buildQueueRows,
  countByStatus,
  type QueueFilter,
  type QueueReason,
  type QueueRow,
  type QueueStatus,
} from "./queueStatus";

const FILTERS: QueueFilter[] = [
  "all",
  "downloading",
  "waiting",
  "importing",
  "stalled",
  "failed",
];

const STATUS_STYLES: Record<QueueStatus, string> = {
  downloading: "bg-sky-500/15 text-sky-300",
  waiting: "bg-neutral-700/60 text-neutral-300",
  importing: "bg-primary-500/15 text-primary-300",
  stalled: "bg-amber-500/15 text-amber-400",
  failed: "bg-rose-500/15 text-rose-400",
};

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function episodeSuffix(season: number | null, episode: number | null): string {
  if (season == null) return "";
  return ` S${pad(season)}${episode != null ? `E${pad(episode)}` : ""}`;
}

function useReasonText() {
  const { t } = useTranslation("common");
  return (reason: QueueReason): string => {
    switch (reason.kind) {
      case "transfer": {
        const eta = formatEtaSeconds(reason.etaSeconds);
        return [
          formatSpeed(reason.speed),
          eta ? t("dashboard.home.etaLeft", { time: eta }) : null,
        ]
          .filter(Boolean)
          .join(" · ");
      }
      case "grabIn":
        return t("activity.queue.reason.grabIn", {
          time: formatEtaSeconds(reason.seconds) ?? "",
          count: reason.candidates,
        });
      case "grabDue":
        return t("activity.queue.reason.grabDue", { count: reason.candidates });
      case "alert":
        return (
          reason.detail ??
          t(
            reason.alertKind === "post_process_error"
              ? "activity.queue.reason.importFailed"
              : reason.alertKind === "download_stuck"
                ? "activity.queue.reason.stalled"
                : "activity.queue.reason.failed",
          )
        );
      default:
        return t(`activity.queue.reason.${reason.kind}`);
    }
  };
}

function AlertActions({ row }: { row: QueueRow }) {
  const { t } = useTranslation("common");
  const retryPost = useRetryLibraryPostProcess();
  const dismiss = useDismissLibraryAttentionAlert();
  const alert = row.alert;
  if (!alert) return null;
  const canRetry =
    alert.kind === "post_process_error" && alert.downloadHistoryId != null;

  return (
    <span className="flex shrink-0 items-center gap-1">
      {canRetry && (
        <button
          type="button"
          disabled={retryPost.isPending}
          onClick={() =>
            retryPost.mutate(alert.downloadHistoryId!, {
              onSuccess: () =>
                toast.success(t("dashboard.libraryAttention.toastPostQueued")),
              onError: () =>
                toast.error(t("dashboard.libraryAttention.toastPostFailed")),
            })
          }
          className="inline-flex items-center gap-1 rounded-md border border-primary-600/60 bg-primary-600/15 px-2 py-1 text-[11px] font-semibold text-primary-400 hover:bg-primary-600/25 disabled:opacity-50"
        >
          {retryPost.isPending && (
            <Loader2 size={11} className="animate-spin" />
          )}
          {t("dashboard.libraryAttention.retryPostProcess")}
        </button>
      )}
      <button
        type="button"
        disabled={dismiss.isPending}
        onClick={() =>
          dismiss.mutate(alert.id, {
            onSuccess: () =>
              toast.success(t("dashboard.libraryAttention.toastDismissOk")),
            onError: () =>
              toast.error(t("dashboard.libraryAttention.toastDismissFail")),
          })
        }
        aria-label={t("dashboard.libraryAttention.dismiss")}
        className="inline-flex size-6 items-center justify-center rounded-md p-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 disabled:opacity-50"
      >
        <X size={14} />
      </button>
    </span>
  );
}

function QueueRowItem({
  row,
  busy,
  onGrabNow,
}: {
  row: QueueRow;
  busy: boolean;
  onGrabNow: (targetKey: string) => void;
}) {
  const { t } = useTranslation("common");
  const reasonText = useReasonText();
  const percent =
    row.progress == null
      ? null
      : Math.min(100, Math.max(0, Math.floor(row.progress * 100)));

  return (
    <li className="flex min-w-0 gap-3 px-4 py-3">
      <div className="flex h-[54px] w-9 shrink-0 items-center justify-center overflow-hidden rounded-md bg-neutral-800">
        {row.posterUrl ? (
          <img
            decoding="async"
            loading="lazy"
            src={row.posterUrl}
            alt=""
            className="h-full w-full object-cover"
          />
        ) : (
          <Film className="h-4 w-4 text-neutral-500" aria-hidden />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <Link
            to="/library/$libraryId"
            params={{ libraryId: String(row.mediaId) }}
            className="block truncate text-sm font-medium text-neutral-100 hover:text-neutral-300"
          >
            {`${row.title}${episodeSuffix(row.season, row.episode)}`}
          </Link>
          <span
            className={cn(
              "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium",
              STATUS_STYLES[row.status],
            )}
          >
            {t(`activity.queue.status.${row.status}`)}
          </span>
        </div>
        {row.releaseTitle && (
          <p className="truncate text-[11px] text-neutral-500">
            {row.releaseTitle}
          </p>
        )}
        {percent != null && (
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            aria-label={row.title}
            className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-neutral-800"
          >
            <div
              className={cn(
                "h-full rounded-full",
                row.status === "downloading" ? "bg-sky-400" : "bg-amber-400",
              )}
              style={{ width: `${percent}%` }}
            />
          </div>
        )}
        <div className="mt-1 flex items-center justify-between gap-2">
          <p className="flex min-w-0 items-center gap-1 text-[11px] tabular-nums text-neutral-400">
            {row.targetKey && (
              <Clock size={11} className="shrink-0" aria-hidden />
            )}
            {percent != null && (
              <span className="font-semibold text-neutral-200">{percent}%</span>
            )}
            <span className="truncate">{reasonText(row.reason)}</span>
          </p>
          {row.alert && <AlertActions row={row} />}
          {row.targetKey && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onGrabNow(row.targetKey!)}
              className="inline-flex shrink-0 items-center gap-1 rounded-md border border-primary-600/60 bg-primary-600/15 px-2 py-1 text-[11px] font-semibold text-primary-400 hover:bg-primary-600/25 disabled:opacity-50"
            >
              {busy ? <Loader2 size={11} className="animate-spin" /> : null}
              {t("dashboard.home.grabNow")}
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

/** Relative "grabs in" labels only need to move about once a minute. */
const CLOCK_TICK_MS = 30_000;

/** Admin-only lane: in-flight downloads and held grabs, each with one plain status and a reason. */
export function QueuePage() {
  const { t } = useTranslation("common");
  const speed = useDownloadsSpeed();
  const active = useActiveDownloads();
  const pending = usePendingReleases(true);
  const attention = useLibraryAttention();
  const grabNow = useGrabPendingNow();
  const isAdmin = useCurrentUser().data?.is_admin === true;
  const [filter, setFilter] = useState<QueueFilter>("all");
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => clearInterval(id);
  }, []);

  const rows = buildQueueRows(
    active.data?.items ?? [],
    pending.data?.items ?? [],
    now,
    attention.data?.items ?? [],
  );
  const counts = countByStatus(rows);
  const shown =
    filter === "all" ? rows : rows.filter((r) => r.status === filter);
  const loading = active.isLoading;
  const enabled = active.data?.enabled ?? speed.data?.enabled ?? false;
  const connected = active.data?.connected ?? speed.data?.connected ?? false;

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div
          role="group"
          aria-label={t("activity.queue.filterLabel")}
          className="flex flex-wrap gap-1"
        >
          {FILTERS.filter(
            (f) => f === "all" || counts[f] > 0 || f === filter,
          ).map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
              className={cn(
                "focus-ring rounded-full px-3 py-1 text-xs font-medium transition-colors",
                filter === f
                  ? "bg-white/[0.1] text-white"
                  : "bg-neutral-800 text-neutral-400 hover:text-neutral-200",
              )}
            >
              {f === "all"
                ? t("activity.queue.all")
                : t(`activity.queue.status.${f}`)}{" "}
              {counts[f]}
            </button>
          ))}
        </div>
        {enabled && connected && (
          <span
            className="ml-auto flex shrink-0 items-center gap-1 font-mono text-sm font-semibold tabular-nums text-sky-400"
            title={t("dashboard.home.transfer")}
          >
            <ArrowDown size={13} aria-hidden />
            {formatSpeed(speed.data?.dl_speed ?? 0)}
          </span>
        )}
      </div>

      {loading ? (
        <p className="py-8 text-center text-sm text-neutral-400">
          {t("common.loading")}
        </p>
      ) : (
        <>
          {(!enabled || !connected) && (
            <div
              className={cn(
                "mb-3 text-center text-sm",
                enabled ? "text-amber-400" : "text-neutral-400",
              )}
            >
              <p>
                {enabled
                  ? t("dashboard.home.downloadClientUnreachable")
                  : t("dashboard.home.downloadClientNotConfigured")}
              </p>
              {isAdmin ? (
                <Link
                  to="/settings/connections"
                  className="focus-ring mt-1 inline-block rounded text-primary-300 underline underline-offset-2"
                >
                  {t("dashboard.home.downloadClientOpenSettings")}
                </Link>
              ) : (
                <p className="mt-1 text-neutral-400">
                  {t("dashboard.home.downloadsUnavailableAskAdmin")}
                </p>
              )}
            </div>
          )}
          {shown.length === 0 ? (
            enabled &&
            connected && (
              <p className="py-8 text-center text-sm text-neutral-400">
                {t("dashboard.home.nothingDownloading")}
              </p>
            )
          ) : (
            <ul className="divide-y divide-neutral-800 rounded-xl border border-neutral-800 bg-neutral-900">
              {shown.map((row) => (
                <QueueRowItem
                  key={row.key}
                  row={row}
                  busy={
                    grabNow.isPending && grabNow.variables === row.targetKey
                  }
                  onGrabNow={(key) => grabNow.mutate(key)}
                />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
