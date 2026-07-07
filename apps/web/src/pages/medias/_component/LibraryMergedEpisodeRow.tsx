import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  ChevronDown,
  ChevronRight,
  Download,
  Eye,
  EyeOff,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDateShort, localDateYmd } from "@rawkoon/shared/utils/date";
import type { LibraryFileInfo } from "@rawkoon/shared/types";
import { useDeleteLibraryEpisode } from "@/features/medias/hooks/useDeleteLibraryEpisode";
import { useRetrySkippedMedia } from "@/features/medias/hooks/useRetrySkippedMedia";
import { useSearchLibraryEpisode } from "@/features/medias/hooks/useSearchLibraryEpisode";
import { useToggleEpisodeMonitored } from "@/features/medias/hooks/useToggleEpisodeMonitored";
import { Badge, StatusDot } from "./LibrarySharedUI";
import { qualityBadges } from "@/utils/libraryDisplayUtils";
import { FileDetailBlock } from "./LibraryFileDetailBlock";
import { useConfirm } from "@/components/confirm/ConfirmContext";

export interface MergedEpisodeRowProps {
  ep: {
    id: number;
    episode: number;
    title: string | null;
    air_date: string | null;
    status: string;
    monitored: boolean;
    search_attempts: number;
  };
  season: number;
  file: LibraryFileInfo | null;
  libraryId: number;
  t: ReturnType<typeof useTranslation>["t"];
  onSearchEpisode?: (ep: {
    id: number;
    season: number;
    episode: number;
    title: string | null;
  }) => void;
  searchEpMut: ReturnType<typeof useSearchLibraryEpisode>;
  retryEpMut: ReturnType<typeof useRetrySkippedMedia>;
  toggleMonitoredMut: ReturnType<typeof useToggleEpisodeMonitored>;
  deleteEpisodeMut: ReturnType<typeof useDeleteLibraryEpisode>;
}

const statusBorderColor: Record<string, string> = {
  downloaded: "border-l-emerald-500/40",
  downloading: "border-l-sky-400/40",
  skipped: "border-l-amber-400/30",
  wanted: "border-l-neutral-600/40",
};

export function MergedEpisodeRow({
  ep,
  season,
  file,
  libraryId,
  t,
  onSearchEpisode,
  searchEpMut,
  retryEpMut,
  toggleMonitoredMut,
  deleteEpisodeMut,
}: MergedEpisodeRowProps) {
  const { i18n } = useTranslation();
  const { confirm } = useConfirm();
  const [expanded, setExpanded] = useState(false);
  const badges = file ? qualityBadges(file) : [];
  const isFuture = ep.air_date != null && ep.air_date > localDateYmd();

  const handleSearch = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onSearchEpisode) return;
    onSearchEpisode({
      id: ep.id,
      season,
      episode: ep.episode,
      title: ep.title ?? null,
    });
  };

  const handleAutoSearch = (e: React.MouseEvent) => {
    e.stopPropagation();
    void searchEpMut
      .mutateAsync({ mediaId: libraryId, episodeId: ep.id })
      .then((r) => {
        if (r.grabbed) toast.success(t("library.management.grabbed"));
        else toast.error(r.reason ?? t("library.management.grabFailed"));
      })
      .catch(() => toast.error(t("library.management.grabFailed")));
  };

  const handleRetry = (e: React.MouseEvent) => {
    e.stopPropagation();
    void retryEpMut
      .mutateAsync({ mediaId: libraryId, episodeId: ep.id })
      .then(() => toast.success(t("library.management.retrySearchQueued")))
      .catch(() => toast.error(t("library.management.grabFailed")));
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!file) return;
    confirm({
      variant: "destructive",
      description: t("library.media.deleteEpisodeConfirm", {
        defaultValue:
          "Delete this episode's downloaded file from disk and reset it to 'wanted'?",
      }),
      confirmLabel: t("common.delete"),
      onConfirm: () => {
        void deleteEpisodeMut
          .mutateAsync({
            mediaId: libraryId,
            episodeId: ep.id,
            deleteFile: true,
          })
          .then(() =>
            toast.success(
              t("library.media.episodeDeleted", {
                defaultValue: "Episode deleted",
              }),
            ),
          )
          .catch(() => toast.error(t("library.management.grabFailed")));
      },
    });
  };

  const handleToggleMonitored = (e: React.MouseEvent) => {
    e.stopPropagation();
    void toggleMonitoredMut
      .mutateAsync({
        mediaId: libraryId,
        episodeId: ep.id,
        monitored: !ep.monitored,
      })
      .catch(() => toast.error(t("library.management.grabFailed")));
  };

  return (
    <div
      className={cn(
        "border-b last:border-b-0 border-border",
        "border-l-2",
        statusBorderColor[ep.status] ?? statusBorderColor.wanted,
      )}
    >
      <button
        type="button"
        onClick={() => file && setExpanded((p) => !p)}
        className={cn(
          "w-full text-left transition-colors",
          "px-3 pr-2 py-2.5 mobile-max:px-4 mobile-max:py-2",
          file && "cursor-pointer hover:bg-neutral-800/40",
          !file && "cursor-default",
          !ep.monitored && "opacity-50",
        )}
      >
        {/* ── Mobile layout (< 945px): stacked rows ── */}
        <div className="flex flex-col gap-1.5 mobile-max:hidden">
          {/* Row 1: status + episode number + title + air date */}
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="flex w-3.5 shrink-0 justify-center">
              <StatusDot status={ep.status} />
            </span>
            <span className="font-mono text-xs tabular-nums text-neutral-400 shrink-0">
              E{String(ep.episode).padStart(2, "0")}
            </span>
            <span className="text-xs text-neutral-300 min-w-0 truncate">
              {ep.title ?? "—"}
            </span>
            {isFuture && ep.air_date && (
              <span className="ml-auto shrink-0 text-[11px] tabular-nums text-neutral-500">
                {formatDateShort(ep.air_date, i18n.language)}
              </span>
            )}
          </div>

          {/* Row 2: badges + actions */}
          <div className="flex items-center gap-1.5 pl-6">
            {badges.slice(0, 2).map((b) => (
              <Badge key={b.label} className={cn(b.cls, "text-[10px]")}>
                {b.label}
              </Badge>
            ))}

            <div className="ml-auto -mr-2 flex items-center">
              {onSearchEpisode && (
                <button
                  type="button"
                  onClick={handleSearch}
                  title={t("library.episodeInteractiveSearchTitle")}
                  className="rounded-md p-2.5 text-neutral-400 hover:text-primary-400 hover:bg-primary-950/30 transition-colors"
                >
                  <Search size={14} />
                </button>
              )}
              {ep.status === "wanted" && (
                <button
                  type="button"
                  onClick={handleAutoSearch}
                  disabled={searchEpMut.isPending}
                  title={t("library.management.episodeSearch")}
                  className="rounded-md p-2.5 text-neutral-400 hover:text-primary-400 hover:bg-primary-950/30 disabled:opacity-50 transition-colors"
                >
                  <Download size={14} />
                </button>
              )}
              {ep.status === "skipped" && (
                <button
                  type="button"
                  title={t("library.management.retrySearchTitle")}
                  onClick={handleRetry}
                  disabled={retryEpMut.isPending}
                  className="rounded-md p-2.5 text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 disabled:opacity-50 transition-colors"
                >
                  <RefreshCw size={14} />
                </button>
              )}
              <button
                type="button"
                title={
                  ep.monitored
                    ? t("library.management.unmonitor")
                    : t("library.management.monitor")
                }
                onClick={handleToggleMonitored}
                disabled={toggleMonitoredMut.isPending}
                className="rounded-md p-2.5 text-neutral-600 hover:text-neutral-400 disabled:opacity-50 transition-colors"
              >
                {ep.monitored ? <Eye size={14} /> : <EyeOff size={14} />}
              </button>
              {file && (
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={deleteEpisodeMut.isPending}
                  title={t("library.media.deleteEpisode", {
                    defaultValue: "Delete episode",
                  })}
                  className="rounded-md p-2.5 text-neutral-400 hover:text-red-400 hover:bg-red-950/30 disabled:opacity-50 transition-colors"
                >
                  <Trash2 size={14} />
                </button>
              )}
              {file && (
                <span className="p-1.5 text-neutral-600">
                  {expanded ? (
                    <ChevronDown size={12} />
                  ) : (
                    <ChevronRight size={12} />
                  )}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* ── Desktop layout (≥ 945px): single row ── */}
        <div className="hidden mobile-max:flex items-center gap-2 min-w-0">
          <StatusDot status={ep.status} />
          <span className="font-mono text-[10px] tabular-nums text-neutral-500 shrink-0 w-8">
            E{String(ep.episode).padStart(2, "0")}
          </span>
          <span className="text-[11px] text-neutral-300 min-w-0 flex-1 truncate">
            {ep.title ?? "—"}
          </span>

          {isFuture && ep.air_date && (
            <span className="shrink-0 text-[10px] tabular-nums text-neutral-500">
              {formatDateShort(ep.air_date, i18n.language)}
            </span>
          )}

          {badges.slice(0, 2).map((b) => (
            <Badge key={b.label} className={cn(b.cls, "text-[9px] py-0")}>
              {b.label}
            </Badge>
          ))}

          <div className="shrink-0 flex items-center gap-0.5">
            {onSearchEpisode && (
              <button
                type="button"
                onClick={handleSearch}
                title={t("library.episodeInteractiveSearchTitle")}
                className="rounded p-1 text-neutral-400 hover:text-primary-400 hover:bg-primary-950/30 transition-colors"
              >
                <Search size={11} />
              </button>
            )}
            {ep.status === "wanted" && (
              <button
                type="button"
                onClick={handleAutoSearch}
                disabled={searchEpMut.isPending}
                className="rounded-md bg-primary-600/90 px-2 py-0.5 text-[9px] font-semibold text-white hover:bg-primary-600 disabled:opacity-50 transition-colors"
              >
                {t("library.management.episodeSearch")}
              </button>
            )}
            {ep.status === "skipped" && (
              <button
                type="button"
                title={t("library.management.retrySearchTitle")}
                onClick={handleRetry}
                disabled={retryEpMut.isPending}
                className="rounded p-1 text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 disabled:opacity-50 transition-colors"
              >
                <RefreshCw size={11} />
              </button>
            )}
            <button
              type="button"
              title={
                ep.monitored
                  ? t("library.management.unmonitor")
                  : t("library.management.monitor")
              }
              onClick={handleToggleMonitored}
              disabled={toggleMonitoredMut.isPending}
              className="rounded p-1 text-neutral-600 hover:text-neutral-400 disabled:opacity-50 transition-colors"
            >
              {ep.monitored ? <Eye size={11} /> : <EyeOff size={11} />}
            </button>
            {file && (
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleteEpisodeMut.isPending}
                title={t("library.media.deleteEpisode", {
                  defaultValue: "Delete episode",
                })}
                className="rounded p-1 text-neutral-400 hover:text-red-400 hover:bg-red-950/30 disabled:opacity-50 transition-colors"
              >
                <Trash2 size={11} />
              </button>
            )}
            {file && (
              <span className="rounded p-1 text-neutral-600">
                {expanded ? (
                  <ChevronDown size={10} />
                ) : (
                  <ChevronRight size={10} />
                )}
              </span>
            )}
          </div>
        </div>
      </button>

      {expanded && file && (
        <div className="px-3 pb-3 pt-2 mobile-max:px-4 border-t border-border bg-neutral-900/20">
          <FileDetailBlock file={file} />
        </div>
      )}
    </div>
  );
}
