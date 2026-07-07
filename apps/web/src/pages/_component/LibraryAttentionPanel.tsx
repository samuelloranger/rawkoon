import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  RefreshCw,
  X,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import type { LibraryAttentionItem } from "@rawkoon/shared/types";
import { useDismissLibraryAttentionAlert } from "@/features/medias/hooks/useDismissLibraryAttentionAlert";
import { useLibraryAttention } from "@/features/medias/hooks/useLibraryAttention";
import { useRetryLibraryPostProcess } from "@/features/medias/hooks/useRetryLibraryPostProcess";
import { useRetrySkippedMedia } from "@/features/medias/hooks/useRetrySkippedMedia";
import { useRetrySkippedSeason } from "@/features/medias/hooks/useRetrySkippedSeason";

type Severity = "fail" | "stall";

function severityOf(kind: LibraryAttentionItem["kind"]): Severity {
  return kind === "download_failed" || kind === "post_process_error"
    ? "fail"
    : "stall";
}

const SEVERITY_ICON: Record<Severity, typeof XCircle> = {
  fail: XCircle,
  stall: Clock,
};

const SEVERITY_ICON_COLOR: Record<Severity, string> = {
  fail: "text-rose-400",
  stall: "text-amber-400",
};

const KIND_LABEL_KEY: Record<LibraryAttentionItem["kind"], string> = {
  download_failed: "dashboard.libraryAttention.kindDownloadFailed",
  post_process_error: "dashboard.libraryAttention.kindPostProcess",
  download_stuck: "dashboard.libraryAttention.kindDownloadStuck",
  grab_skipped: "dashboard.libraryAttention.kindGrabSkipped",
  auto_grab_stalled: "dashboard.libraryAttention.kindAutoGrabStalled",
};

function tvLabel(item: LibraryAttentionItem): string | null {
  if (item.media_type !== "show") return null;
  if (
    item.scope_type === "season_pack" &&
    item.season != null &&
    item.season > 0
  ) {
    return `S${String(item.season).padStart(2, "0")}`;
  }
  if (
    item.scope_type === "episode" &&
    item.season != null &&
    item.episode_number != null
  ) {
    return `S${String(item.season).padStart(2, "0")}E${String(item.episode_number).padStart(2, "0")}`;
  }
  return null;
}

function Kicker({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-neutral-400">
      {children}
    </span>
  );
}

function SkeletonRow() {
  return (
    <div className="px-4 py-3 border-b border-neutral-800 last:border-0">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 h-7 w-7 shrink-0 rounded-lg bg-neutral-800 animate-pulse" />
        <div className="flex-1 space-y-2">
          <div className="h-3 w-24 rounded bg-neutral-800 animate-pulse" />
          <div className="h-4 w-3/5 rounded bg-neutral-800 animate-pulse" />
        </div>
      </div>
    </div>
  );
}

function AttentionRow({
  item,
  onRetryPost,
  onResetWanted,
  onRetrySeason,
  onDismiss,
  postLoadingId,
  resetLoadingKey,
  seasonResetKey,
  dismissLoadingId,
}: {
  item: LibraryAttentionItem;
  onRetryPost: (dhId: number) => void;
  onResetWanted: (mediaId: number, episodeId?: number) => void;
  onRetrySeason: (mediaId: number, season: number) => void;
  onDismiss: (alertId: number) => void;
  postLoadingId: number | null;
  resetLoadingKey: string | null;
  seasonResetKey: string | null;
  dismissLoadingId: number | null;
}) {
  const { t } = useTranslation("common");
  const severity = severityOf(item.kind);
  const SeverityIcon = SEVERITY_ICON[severity];
  const tv = tvLabel(item);
  const isPostProcess = item.kind === "post_process_error";
  const linkTab = isPostProcess ? ("management" as const) : ("search" as const);

  const resetKey = `${item.media_id}:${item.episode_id ?? "m"}`;
  const seasonKey =
    item.scope_type === "season_pack" && item.season != null && item.season > 0
      ? `${item.media_id}:s${item.season}`
      : null;

  const canResetSeason =
    item.scope_type === "season_pack" &&
    item.kind === "grab_skipped" &&
    seasonKey != null;
  const canResetItem =
    item.scope_type !== "season_pack" &&
    (item.kind === "grab_skipped" || item.kind === "auto_grab_stalled");
  const canRetryIngest = isPostProcess && item.download_history_id != null;

  const primary: {
    label: string;
    busy: boolean;
    onClick: () => void;
  } | null = canRetryIngest
    ? {
        label: t("dashboard.libraryAttention.retryPostProcess"),
        busy: postLoadingId === item.download_history_id,
        onClick: () => onRetryPost(item.download_history_id!),
      }
    : canResetSeason
      ? {
          label: t("dashboard.libraryAttention.resetAutoAttempts"),
          busy: seasonResetKey === seasonKey,
          onClick: () => onRetrySeason(item.media_id, item.season as number),
        }
      : canResetItem
        ? {
            label: t("dashboard.libraryAttention.resetAutoAttempts"),
            busy: resetLoadingKey === resetKey,
            onClick: () =>
              onResetWanted(item.media_id, item.episode_id ?? undefined),
          }
        : null;

  return (
    <div className="px-4 py-3 border-b border-neutral-800 last:border-0 transition-colors hover:bg-neutral-800/40">
      <div className="flex items-start gap-3">
        <span
          className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-neutral-700 bg-neutral-800 ${SEVERITY_ICON_COLOR[severity]}`}
          aria-hidden
        >
          <SeverityIcon size={14} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Kicker>{t(KIND_LABEL_KEY[item.kind])}</Kicker>
            {tv ? (
              <span className="text-[10px] font-semibold tracking-wide text-neutral-500">
                {tv}
              </span>
            ) : null}
          </div>
          <Link
            to="/library/$libraryId"
            params={{ libraryId: String(item.media_id) }}
            search={{ tab: linkTab }}
            className="block mt-0.5 text-sm font-medium text-neutral-100 truncate hover:text-neutral-300 transition-colors"
          >
            {item.media_title}
          </Link>
          {item.detail ? (
            <p className="mt-1 text-[11px] text-neutral-400 line-clamp-2 break-words">
              {item.detail}
            </p>
          ) : item.search_attempts != null && item.search_attempts > 0 ? (
            <p className="mt-1 text-[11px] text-neutral-400">
              {t("dashboard.libraryAttention.autoAttempts", {
                count: item.search_attempts,
              })}
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {primary ? (
            <button
              type="button"
              disabled={primary.busy}
              onClick={primary.onClick}
              className="inline-flex items-center gap-1 rounded-md border border-primary-600/60 bg-primary-600/15 px-2 py-1 text-[11px] font-semibold text-primary-400 hover:bg-primary-600/25 disabled:opacity-50"
            >
              {primary.busy ? (
                <Loader2 size={12} className="animate-spin" />
              ) : null}
              {primary.label}
            </button>
          ) : null}
          <button
            type="button"
            disabled={dismissLoadingId === item.id}
            onClick={() => onDismiss(item.id)}
            aria-label={t("dashboard.libraryAttention.dismiss")}
            className="p-1 rounded-md text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 disabled:opacity-50"
          >
            {dismissLoadingId === item.id ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <X size={14} />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

export function LibraryAttentionPanel() {
  const { t } = useTranslation("common");
  const { data, isLoading, isError, refetch, isFetching } =
    useLibraryAttention();
  const retryPost = useRetryLibraryPostProcess();
  const retrySkipped = useRetrySkippedMedia();
  const retrySeason = useRetrySkippedSeason();
  const dismissAlert = useDismissLibraryAttentionAlert();

  const items = data?.items ?? [];

  const postLoadingId = retryPost.isPending
    ? (retryPost.variables ?? null)
    : null;
  const resetLoadingKey = retrySkipped.isPending
    ? `${retrySkipped.variables?.mediaId}:${retrySkipped.variables?.episodeId ?? "m"}`
    : null;
  const seasonResetKey = retrySeason.isPending
    ? `${retrySeason.variables?.mediaId}:s${retrySeason.variables?.season}`
    : null;
  const dismissLoadingId = dismissAlert.isPending
    ? (dismissAlert.variables ?? null)
    : null;

  return (
    <section className="rounded-xl border border-neutral-800 bg-neutral-900 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-800">
        <div className="flex items-center gap-2">
          <AlertTriangle
            size={14}
            className="text-amber-400 shrink-0"
            aria-hidden
          />
          <Kicker>{t("dashboard.libraryAttention.title")}</Kicker>
          {!isLoading && items.length > 0 ? (
            <span className="font-display text-xs font-semibold text-neutral-100 tabular-nums">
              {items.length}
            </span>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => refetch()}
          disabled={isFetching}
          className="p-1.5 rounded-md text-neutral-500 hover:bg-neutral-800 disabled:opacity-50"
          aria-label={t("dashboard.libraryAttention.refresh")}
        >
          <RefreshCw size={14} className={isFetching ? "animate-spin" : ""} />
        </button>
      </div>

      {isError ? (
        <div className="px-4 py-3 flex items-center gap-2 text-xs text-rose-400">
          <AlertTriangle size={14} className="shrink-0" />
          {t("dashboard.libraryAttention.loadError")}
          <button
            type="button"
            onClick={() => refetch()}
            className="ml-auto text-[11px] font-semibold underline"
          >
            {t("dashboard.libraryAttention.retry")}
          </button>
        </div>
      ) : isLoading ? (
        <div>
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </div>
      ) : items.length === 0 ? (
        <div className="px-4 py-7 flex flex-col items-center gap-2 text-center">
          <span className="flex h-9 w-9 items-center justify-center rounded-full border border-neutral-700 bg-neutral-800 text-emerald-400">
            <CheckCircle2 size={18} />
          </span>
          <p className="text-xs text-neutral-400">
            {t("dashboard.libraryAttention.emptyState")}
          </p>
        </div>
      ) : (
        <div>
          {items.map((item) => (
            <AttentionRow
              key={item.id}
              item={item}
              postLoadingId={postLoadingId}
              resetLoadingKey={resetLoadingKey}
              seasonResetKey={seasonResetKey}
              dismissLoadingId={dismissLoadingId}
              onDismiss={(id) => {
                dismissAlert.mutate(id, {
                  onSuccess: () =>
                    toast.success(
                      t("dashboard.libraryAttention.toastDismissOk"),
                    ),
                  onError: () =>
                    toast.error(
                      t("dashboard.libraryAttention.toastDismissFail"),
                    ),
                });
              }}
              onRetryPost={(dhId) => {
                retryPost.mutate(dhId, {
                  onSuccess: () =>
                    toast.success(
                      t("dashboard.libraryAttention.toastPostQueued"),
                    ),
                  onError: () =>
                    toast.error(
                      t("dashboard.libraryAttention.toastPostFailed"),
                    ),
                });
              }}
              onResetWanted={(mediaId, episodeId) => {
                retrySkipped.mutate(
                  { mediaId, episodeId },
                  {
                    onSuccess: () =>
                      toast.success(
                        t("dashboard.libraryAttention.toastResetOk"),
                      ),
                    onError: () =>
                      toast.error(
                        t("dashboard.libraryAttention.toastResetFail"),
                      ),
                  },
                );
              }}
              onRetrySeason={(mediaId, season) => {
                retrySeason.mutate(
                  { mediaId, season },
                  {
                    onSuccess: () =>
                      toast.success(
                        t("dashboard.libraryAttention.toastResetOk"),
                      ),
                    onError: () =>
                      toast.error(
                        t("dashboard.libraryAttention.toastResetFail"),
                      ),
                  },
                );
              }}
            />
          ))}
        </div>
      )}
    </section>
  );
}
