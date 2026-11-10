import { toast } from "sonner";
import type { useTranslation } from "react-i18next";
import {
  ChevronRight,
  Eye,
  EyeOff,
  Gauge,
  Layers,
  RefreshCw,
  Search,
} from "lucide-react";
import type { LibraryFileInfo } from "@rawkoon/shared/types";
import type { useLibraryEpisodes } from "@/features/medias/hooks/useLibraryEpisodes";
import type { useSearchLibraryEpisode } from "@/features/medias/hooks/useSearchLibraryEpisode";
import type { useSearchSeasonPack } from "@/features/medias/hooks/useSearchSeasonPack";
import type { useRetrySkippedMedia } from "@/features/medias/hooks/useRetrySkippedMedia";
import type { useRetrySkippedSeason } from "@/features/medias/hooks/useRetrySkippedSeason";
import type { useToggleEpisodeMonitored } from "@/features/medias/hooks/useToggleEpisodeMonitored";
import type { useToggleSeasonMonitored } from "@/features/medias/hooks/useToggleSeasonMonitored";
import type { useDeleteLibraryEpisode } from "@/features/medias/hooks/useDeleteLibraryEpisode";
import { cn } from "@/lib/utils";
import { Badge } from "./LibrarySharedUI";
import { qualityBadges, isUniform } from "@/utils/libraryDisplayUtils";
import { ClipPanel } from "./ClipPanel";
import { MergedEpisodeRow } from "./LibraryMergedEpisodeRow";

type Season = NonNullable<
  ReturnType<typeof useLibraryEpisodes>["data"]
>["seasons"][number];

interface LibraryShowSeasonProps {
  s: Season;
  libraryId: number;
  files: LibraryFileInfo[];
  fileByEp: Map<string, LibraryFileInfo>;
  isExpanded: boolean;
  toggleSeason: (season: number) => void;
  setReencode: (value: { season: number | null }) => void;
  t: ReturnType<typeof useTranslation>["t"];
  onSearchEpisode?: (ep: {
    id: number;
    season: number;
    episode: number;
    title: string | null;
  }) => void;
  onSearchSeason?: (season: number) => void;
  searchEpMut: ReturnType<typeof useSearchLibraryEpisode>;
  searchSeasonPackMut: ReturnType<typeof useSearchSeasonPack>;
  retryEpMut: ReturnType<typeof useRetrySkippedMedia>;
  retrySeasonMut: ReturnType<typeof useRetrySkippedSeason>;
  toggleEpMonitoredMut: ReturnType<typeof useToggleEpisodeMonitored>;
  toggleSeasonMonitoredMut: ReturnType<typeof useToggleSeasonMonitored>;
  deleteEpisodeMut: ReturnType<typeof useDeleteLibraryEpisode>;
}

export function LibraryShowSeason({
  s,
  libraryId,
  files,
  fileByEp,
  isExpanded,
  toggleSeason,
  setReencode,
  t,
  onSearchEpisode,
  onSearchSeason,
  searchEpMut,
  searchSeasonPackMut,
  retryEpMut,
  retrySeasonMut,
  toggleEpMonitoredMut,
  toggleSeasonMonitoredMut,
  deleteEpisodeMut,
}: LibraryShowSeasonProps) {
  const downloadedCount = s.episodes.filter(
    (e) => e.status === "downloaded",
  ).length;
  const skippedCount = s.episodes.filter((e) => e.status === "skipped").length;
  const allMonitored = s.episodes.every((e) => e.monitored);
  const anyMonitored = s.episodes.some((e) => e.monitored);
  const progress =
    s.episodes.length > 0 ? downloadedCount / s.episodes.length : 0;
  const allDone = downloadedCount === s.episodes.length;
  const noneDone = downloadedCount === 0;
  const anyDownloading = s.episodes.some((e) => e.status === "downloading");
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
                  .catch(() => toast.error(t("library.management.grabFailed")));
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
          <button
            type="button"
            onClick={() => setReencode({ season: s.season })}
            title={t("transcode.openSeason")}
            className="rounded-md p-2.5 mobile-max:px-3 mobile-max:py-3 text-neutral-400 hover:text-primary-400 hover:bg-primary-950/30 transition-colors"
          >
            <Gauge size={14} className="mobile-max:size-3" />
          </button>
          {skippedCount > 0 && (
            <button
              type="button"
              title={t("library.management.retrySkippedSeasonTitle", {
                count: skippedCount,
              })}
              disabled={retrySeasonMut.isPending}
              onClick={() => {
                void retrySeasonMut
                  .mutateAsync({
                    mediaId: libraryId,
                    season: s.season,
                  })
                  .then((r) =>
                    toast.success(
                      t("library.management.retrySkippedSeasonQueued", {
                        count: r.retried,
                      }),
                    ),
                  )
                  .catch(() => toast.error(t("library.management.grabFailed")));
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
                .catch(() => toast.error(t("library.management.grabFailed")));
            }}
            className={cn(
              "rounded-md p-2.5 mobile-max:px-3 mobile-max:py-3 transition-colors disabled:opacity-50",
              anyMonitored
                ? "text-neutral-400 hover:text-neutral-300 hover:bg-neutral-800/40"
                : "text-neutral-500 hover:text-neutral-400 hover:bg-neutral-800/40",
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
          <div className="px-4 py-3 empty:hidden">
            <ClipPanel libraryId={libraryId} season={s.season} />
          </div>
          {s.episodes.map((ep) => (
            <MergedEpisodeRow
              key={ep.id}
              ep={ep}
              season={s.season}
              file={fileByEp.get(`${s.season}_${ep.episode}`) ?? null}
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
}
