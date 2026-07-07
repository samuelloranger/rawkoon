import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useLibraryFiles } from "@/features/medias/hooks/useLibraryFiles";
import { useLibraryEpisodes } from "@/features/medias/hooks/useLibraryEpisodes";
import { useRescanLibraryItem } from "@/features/medias/hooks/useRescanLibraryItem";
import { useSearchLibraryEpisode } from "@/features/medias/hooks/useSearchLibraryEpisode";
import { useSearchSeasonPack } from "@/features/medias/hooks/useSearchSeasonPack";
import { useRetrySkippedMedia } from "@/features/medias/hooks/useRetrySkippedMedia";
import { useRetrySkippedSeason } from "@/features/medias/hooks/useRetrySkippedSeason";
import { useToggleEpisodeMonitored } from "@/features/medias/hooks/useToggleEpisodeMonitored";
import { useToggleSeasonMonitored } from "@/features/medias/hooks/useToggleSeasonMonitored";
import { useDeleteLibraryEpisode } from "@/features/medias/hooks/useDeleteLibraryEpisode";
import { useDeleteLibraryFile } from "@/features/medias/hooks/useDeleteLibraryFile";
import type { LibraryFileInfo } from "@rawkoon/shared/types";
import {
  ChevronRight,
  Eye,
  EyeOff,
  Folder,
  Layers,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge, Card } from "./LibrarySharedUI";
import {
  qualityBadges,
  isUniform,
  getMappedFolder,
} from "@/utils/libraryDisplayUtils";
import { FileDetailBlock } from "./LibraryFileDetailBlock";
import { MergedEpisodeRow } from "./LibraryMergedEpisodeRow";

interface LibraryMediaSectionProps {
  libraryId: number;
  onSearchEpisode?: (ep: {
    id: number;
    season: number;
    episode: number;
    title: string | null;
  }) => void;
  onSearchSeason?: (season: number) => void;
}

export function LibraryMediaSection({
  libraryId,
  onSearchEpisode,
  onSearchSeason,
}: LibraryMediaSectionProps) {
  const { t } = useTranslation("common");
  const { data, isLoading } = useLibraryFiles(libraryId);
  const rescan = useRescanLibraryItem(libraryId);
  const deleteFile = useDeleteLibraryFile(libraryId);
  const deleteEpisodeMut = useDeleteLibraryEpisode(libraryId);
  const searchEpMut = useSearchLibraryEpisode();
  const searchSeasonPackMut = useSearchSeasonPack();
  const retryEpMut = useRetrySkippedMedia();
  const retrySeasonMut = useRetrySkippedSeason();
  const toggleEpMonitoredMut = useToggleEpisodeMonitored();
  const toggleSeasonMonitoredMut = useToggleSeasonMonitored();
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [expandedSeasons, setExpandedSeasons] = useState<Set<number>>(
    new Set(),
  );

  const files = useMemo(() => data?.files ?? [], [data?.files]);
  const isShow = data?.media_type === "show";
  const episodesQuery = useLibraryEpisodes(isShow ? libraryId : null);

  const fileByEp = useMemo(() => {
    const m = new Map<string, LibraryFileInfo>();
    for (const f of files) {
      if (f.season != null && f.episode != null) {
        m.set(`${f.season}_${f.episode}`, f);
      }
    }
    return m;
  }, [files]);

  const hasEpisodes = isShow && episodesQuery.data != null;

  const toggleSeason = (season: number) =>
    setExpandedSeasons((prev) => {
      const next = new Set(prev);
      if (next.has(season)) {
        next.delete(season);
      } else {
        next.add(season);
      }
      return next;
    });

  if (isLoading) {
    return (
      <div className="px-5 py-10 text-center text-sm text-neutral-500">
        {t("library.media.loadingFileInfo")}
      </div>
    );
  }

  const mappedFolder = files.length ? getMappedFolder(files, isShow) : null;

  return (
    <Card>
      {/* Header — always visible */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <Folder size={13} className="text-neutral-400 shrink-0" />
          {mappedFolder && (
            <span className="text-[10px] font-mono text-neutral-400 truncate">
              {mappedFolder}
            </span>
          )}
        </div>
        <button
          onClick={() => rescan.mutate()}
          disabled={rescan.isPending}
          className={cn(
            "inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors shrink-0",
            "text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800",
            "disabled:opacity-50 disabled:cursor-not-allowed",
          )}
        >
          <RefreshCw
            size={10}
            className={rescan.isPending ? "animate-spin" : ""}
          />
          {rescan.isPending
            ? "Rescanning…"
            : rescan.isSuccess
              ? `Done (${rescan.data?.rescanned})`
              : "Rescan files"}
        </button>
      </div>

      {isShow && episodesQuery.isLoading && (
        <div className="px-4 py-4 text-xs text-neutral-400">
          {t("library.media.loadingEpisodes")}
        </div>
      )}

      {!files.length && !hasEpisodes && !episodesQuery.isLoading && (
        <div className="px-4 py-4 text-xs text-neutral-500">
          {t("library.media.noFileMetadata")}
        </div>
      )}

      {isShow ? (
        /* Show: merged episodes + files by season */
        hasEpisodes ? (
          <div className="divide-y divide-border">
            {episodesQuery.data!.seasons.map((s) => {
              const isExpanded = expandedSeasons.has(s.season);
              const downloadedCount = s.episodes.filter(
                (e) => e.status === "downloaded",
              ).length;
              const skippedCount = s.episodes.filter(
                (e) => e.status === "skipped",
              ).length;
              const allMonitored = s.episodes.every((e) => e.monitored);
              const anyMonitored = s.episodes.some((e) => e.monitored);
              const progress =
                s.episodes.length > 0 ? downloadedCount / s.episodes.length : 0;
              const allDone = downloadedCount === s.episodes.length;
              const noneDone = downloadedCount === 0;
              const anyDownloading = s.episodes.some(
                (e) => e.status === "downloading",
              );
              const packEligible = noneDone && !anyDownloading;

              const sFiles = files.filter((f) => f.season === s.season);
              const uRes = isUniform(sFiles.map((f) => f.resolution));
              const uSrc = isUniform(sFiles.map((f) => f.source));
              const uCodec = isUniform(sFiles.map((f) => f.video_codec));
              const uHdr = isUniform(sFiles.map((f) => f.hdr_format));
              const uBitDepth = isUniform(sFiles.map((f) => f.bit_depth));
              const sznBadges = qualityBadges({
                resolution: uRes,
                source: uSrc,
                video_codec: uCodec,
                hdr_format: uHdr,
                bit_depth: uBitDepth,
              });

              return (
                <div key={s.season}>
                  {/* ── Season header ── */}
                  <div className="flex items-center gap-0 mobile-max:gap-0">
                    {/* Expand toggle — takes available space */}
                    <button
                      type="button"
                      onClick={() => toggleSeason(s.season)}
                      className="flex flex-1 min-w-0 items-center gap-2.5 mobile-max:gap-3 px-4 py-3 hover:bg-neutral-800/40 transition-colors text-left"
                    >
                      <ChevronRight
                        size={14}
                        className={cn(
                          "text-neutral-400 shrink-0 transition-transform duration-150 mobile-max:size-3",
                          isExpanded && "rotate-90",
                        )}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className="text-xs font-semibold text-neutral-100 mobile-max:text-[11px]">
                            {t("library.media.season")} {s.season}
                          </span>
                          <span
                            className={cn(
                              "text-[11px] tabular-nums mobile-max:text-[10px]",
                              allDone ? "text-emerald-400" : "text-neutral-500",
                            )}
                          >
                            {downloadedCount}/{s.episodes.length}
                          </span>
                          {sznBadges.slice(0, 2).map((b) => (
                            <Badge
                              key={b.label}
                              className={cn(
                                b.cls,
                                "text-[10px] py-0 mobile-max:text-[9px]",
                              )}
                            >
                              {b.label}
                            </Badge>
                          ))}
                        </div>
                        <div className="h-1 rounded-full bg-neutral-800 overflow-hidden">
                          <div
                            className={cn(
                              "h-full rounded-full transition-all duration-300",
                              allDone
                                ? "bg-emerald-500"
                                : noneDone
                                  ? "bg-neutral-700"
                                  : "bg-primary-500",
                            )}
                            style={{
                              width: `${Math.max(progress * 100, noneDone ? 0 : 4)}%`,
                            }}
                          />
                        </div>
                      </div>
                    </button>

                    {/* Action buttons — fixed to the right */}
                    <div className="flex shrink-0 items-center">
                      {packEligible && (
                        <button
                          type="button"
                          title={t(
                            "library.management.searchSeasonPack",
                            "Search season pack",
                          )}
                          disabled={searchSeasonPackMut.isPending}
                          onClick={() => {
                            void searchSeasonPackMut
                              .mutateAsync({
                                mediaId: libraryId,
                                season: s.season,
                              })
                              .then((r) => {
                                if (r.grabbed) {
                                  toast.success(
                                    t(
                                      "library.management.seasonPackGrabbed",
                                      "Season pack grabbed!",
                                    ),
                                  );
                                } else {
                                  toast.info(
                                    t(
                                      "library.management.seasonPackNotFound",
                                      "No season pack found — episodes will be searched individually.",
                                    ),
                                  );
                                }
                              })
                              .catch(() =>
                                toast.error(t("library.management.grabFailed")),
                              );
                          }}
                          className="rounded-md p-2.5 mobile-max:px-3 mobile-max:py-3 text-neutral-400 hover:text-emerald-400 hover:bg-emerald-950/30 disabled:opacity-50 transition-colors"
                        >
                          <Layers size={14} className="mobile-max:size-3" />
                        </button>
                      )}
                      {onSearchSeason && (
                        <button
                          type="button"
                          onClick={() => onSearchSeason(s.season)}
                          title={t(
                            "library.management.searchSeasonManual",
                            "Browse torrents for this season",
                          )}
                          className="rounded-md p-2.5 mobile-max:px-3 mobile-max:py-3 text-neutral-400 hover:text-primary-400 hover:bg-primary-950/30 transition-colors"
                        >
                          <Search size={14} className="mobile-max:size-3" />
                        </button>
                      )}
                      {skippedCount > 0 && (
                        <button
                          type="button"
                          title={t(
                            "library.management.retrySkippedSeasonTitle",
                            {
                              count: skippedCount,
                            },
                          )}
                          disabled={retrySeasonMut.isPending}
                          onClick={() => {
                            void retrySeasonMut
                              .mutateAsync({
                                mediaId: libraryId,
                                season: s.season,
                              })
                              .then((r) =>
                                toast.success(
                                  t(
                                    "library.management.retrySkippedSeasonQueued",
                                    { count: r.retried },
                                  ),
                                ),
                              )
                              .catch(() =>
                                toast.error(t("library.management.grabFailed")),
                              );
                          }}
                          className="rounded-md p-2.5 mobile-max:px-3 mobile-max:py-3 text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 disabled:opacity-50 transition-colors"
                        >
                          <RefreshCw size={14} className="mobile-max:size-3" />
                        </button>
                      )}
                      <button
                        type="button"
                        title={
                          allMonitored
                            ? t("library.management.unmonitorSeason")
                            : t("library.management.monitorSeason")
                        }
                        disabled={toggleSeasonMonitoredMut.isPending}
                        onClick={() => {
                          void toggleSeasonMonitoredMut
                            .mutateAsync({
                              mediaId: libraryId,
                              season: s.season,
                              monitored: !anyMonitored,
                            })
                            .catch(() =>
                              toast.error(t("library.management.grabFailed")),
                            );
                        }}
                        className={cn(
                          "rounded-md p-2.5 mobile-max:px-3 mobile-max:py-3 transition-colors disabled:opacity-50",
                          anyMonitored
                            ? "text-neutral-400 hover:text-neutral-300 hover:bg-neutral-800/40"
                            : "text-neutral-600 hover:text-neutral-400 hover:bg-neutral-800/40",
                        )}
                      >
                        {anyMonitored ? (
                          <Eye size={14} className="mobile-max:size-3" />
                        ) : (
                          <EyeOff size={14} className="mobile-max:size-3" />
                        )}
                      </button>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="divide-y divide-border border-t border-border bg-neutral-900/30">
                      {s.episodes.map((ep) => (
                        <MergedEpisodeRow
                          key={ep.id}
                          ep={ep}
                          season={s.season}
                          file={
                            fileByEp.get(`${s.season}_${ep.episode}`) ?? null
                          }
                          libraryId={libraryId}
                          t={t}
                          onSearchEpisode={onSearchEpisode}
                          searchEpMut={searchEpMut}
                          retryEpMut={retryEpMut}
                          toggleMonitoredMut={toggleEpMonitoredMut}
                          deleteEpisodeMut={deleteEpisodeMut}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          /* Episodes not loaded yet but files exist — group by season */
          <div className="divide-y divide-border">
            {Array.from(
              files.reduce((map, f) => {
                const s = f.season ?? 0;
                if (!map.has(s)) map.set(s, []);
                map.get(s)!.push(f);
                return map;
              }, new Map<number, LibraryFileInfo[]>()),
            )
              .sort(([a], [b]) => a - b)
              .map(([season, sFiles]) => {
                const isExpanded = expandedSeasons.has(season);
                const uRes = isUniform(sFiles.map((f) => f.resolution));
                const uSrc = isUniform(sFiles.map((f) => f.source));
                const uCodec = isUniform(sFiles.map((f) => f.video_codec));
                const uHdr = isUniform(sFiles.map((f) => f.hdr_format));
                const uBitDepth = isUniform(sFiles.map((f) => f.bit_depth));
                const sznBadges = qualityBadges({
                  resolution: uRes,
                  source: uSrc,
                  video_codec: uCodec,
                  hdr_format: uHdr,
                  bit_depth: uBitDepth,
                });

                return (
                  <div
                    key={season}
                    className="border-b border-border last:border-0"
                  >
                    <button
                      type="button"
                      onClick={() => toggleSeason(season)}
                      className="w-full flex items-center gap-2.5 px-4 py-2.5 hover:bg-neutral-800/40 transition-colors text-left"
                    >
                      <ChevronRight
                        size={12}
                        className={cn(
                          "text-neutral-400 shrink-0 transition-transform duration-150",
                          isExpanded && "rotate-90",
                        )}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-semibold text-neutral-200 leading-tight">
                          {t("library.media.season")} {season}
                        </div>
                        <div className="text-[10px] text-neutral-500 leading-tight mt-0.5">
                          {t("library.media.filesCount", {
                            count: sFiles.length,
                          })}
                        </div>
                      </div>
                      <div className="flex gap-1 flex-wrap justify-end shrink-0">
                        {sznBadges.map((b) => (
                          <Badge key={b.label} className={b.cls}>
                            {b.label}
                          </Badge>
                        ))}
                      </div>
                    </button>
                    {isExpanded && (
                      <div className="divide-y divide-border border-t border-border">
                        {sFiles.map((f) => {
                          const epCode =
                            f.episode != null
                              ? `E${String(f.episode).padStart(2, "0")}`
                              : "?";
                          const fBadges = qualityBadges(f);
                          return (
                            <div
                              key={f.id}
                              className="border-b last:border-0 border-border"
                            >
                              <div className="flex items-center gap-2 px-4 py-2">
                                <span className="font-mono text-[10px] font-medium text-neutral-500 w-7 shrink-0">
                                  {epCode}
                                </span>
                                <span className="text-[11px] text-neutral-300 flex-1 min-w-0 truncate">
                                  {f.episode_title ?? f.file_name}
                                </span>
                                <div className="flex gap-0.5 shrink-0">
                                  {fBadges.slice(0, 2).map((b) => (
                                    <Badge
                                      key={b.label}
                                      className={cn(b.cls, "text-[9px] py-0")}
                                    >
                                      {b.label}
                                    </Badge>
                                  ))}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        )
      ) : (
        /* Movie: flat */
        <div className="px-4 py-3 space-y-4">
          {files.map((file, fileIdx) => {
            const badges = qualityBadges(file);
            const isConfirming = deleteConfirmId === file.id;
            return (
              <div
                key={file.id}
                className={cn(
                  files.length > 1 &&
                    "border-t border-border pt-4 first:border-none first:pt-0",
                )}
              >
                {files.length > 1 && (
                  <p className="text-xs font-semibold text-neutral-500 mb-2">
                    {t("library.media.fileLabel")} {fileIdx + 1}
                  </p>
                )}
                <div className="flex items-center gap-1 flex-wrap mb-3">
                  {badges.map((b) => (
                    <Badge key={b.label} className={b.cls}>
                      {b.label}
                    </Badge>
                  ))}
                  {isConfirming ? (
                    <div className="flex items-center gap-1.5 ml-1">
                      <span className="text-[10px] text-neutral-400">
                        {t("library.media.deleteFileOnDisk")}
                      </span>
                      <button
                        type="button"
                        disabled={deleteFile.isPending}
                        onClick={() => {
                          deleteFile.mutate(
                            { fileId: file.id, deleteFile: true },
                            { onSettled: () => setDeleteConfirmId(null) },
                          );
                        }}
                        className="rounded px-2 py-0.5 text-xs font-medium bg-rose-600 text-white hover:bg-rose-500 disabled:opacity-50 transition-colors"
                      >
                        {t("library.media.yesDelete")}
                      </button>
                      <button
                        type="button"
                        disabled={deleteFile.isPending}
                        onClick={() => {
                          deleteFile.mutate(
                            { fileId: file.id, deleteFile: false },
                            { onSettled: () => setDeleteConfirmId(null) },
                          );
                        }}
                        className="rounded px-2 py-0.5 text-xs font-medium bg-neutral-700 text-neutral-300 hover:bg-neutral-600 disabled:opacity-50 transition-colors"
                      >
                        {t("library.media.keepFile")}
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteConfirmId(null)}
                        className="text-xs text-neutral-400 hover:text-neutral-300 transition-colors"
                      >
                        {t("common.cancel")}
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setDeleteConfirmId(file.id)}
                      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-neutral-400 hover:text-red-500 hover:bg-red-950/30 transition-colors ml-1"
                    >
                      <Trash2 size={10} />
                      {t("common.remove")}
                    </button>
                  )}
                </div>
                <FileDetailBlock file={file} />
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
