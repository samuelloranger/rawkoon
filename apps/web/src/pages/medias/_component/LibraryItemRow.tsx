import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { Search, Film, Tv, ArrowUpCircle, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDate } from "@rawkoon/shared/utils/date";
import type { LibraryMedia } from "@rawkoon/shared/types";
import { usePrefetchLibraryItem } from "@/features/medias/hooks/usePrefetchLibraryItem";
import { libraryStatusPresentation } from "@/utils/libraryStatusPresentation";

function formatBytes(bytesStr: string | null | undefined): string | null {
  if (!bytesStr) return null;
  const n = Number(bytesStr);
  if (!n) return null;
  if (n >= 1e12) return `${(n / 1e12).toFixed(1)} TB`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} MB`;
  return `${n} B`;
}

function formatResolution(res: number | null): string | null {
  if (!res) return null;
  if (res >= 2160) return "4K";
  if (res >= 1080) return "1080p";
  if (res >= 720) return "720p";
  if (res >= 576) return "576p";
  return "480p";
}

function formatCodec(codec: string | null): string | null {
  if (!codec) return null;
  const c = codec.toLowerCase().replace(/[.\s-]/g, "");
  if (c.includes("hevc") || c.includes("h265")) return "H.265";
  if (c.includes("avc") || c.includes("h264")) return "H.264";
  if (c === "av1") return "AV1";
  if (c === "vp9") return "VP9";
  return codec.toUpperCase();
}

function formatDuration(secs: number | null): string | null {
  if (!secs || secs < 60) return null;
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function MiniPoster({ posterUrl }: { posterUrl: string | null | undefined }) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  if (!posterUrl || error) {
    return (
      <div className="flex items-center justify-center w-full h-full bg-neutral-800 rounded-lg">
        <Film className="size-4 text-white/30" />
      </div>
    );
  }

  return (
    <>
      {!loaded && (
        <div className="absolute inset-0 rounded-lg bg-neutral-800 animate-pulse" />
      )}
      <img
        src={posterUrl}
        alt=""
        aria-hidden="true"
        loading="lazy"
        onLoad={() => setLoaded(true)}
        onError={() => setError(true)}
        className={cn(
          "absolute inset-0 w-full h-full object-cover rounded-lg transition-opacity duration-300",
          loaded ? "opacity-100" : "opacity-0",
        )}
      />
    </>
  );
}

interface LibraryItemRowProps {
  item: LibraryMedia;
  onMovieSearch?: (id: number) => void;
  movieSearchPending?: boolean;
}

export function LibraryItemRow({
  item,
  onMovieSearch,
  movieSearchPending,
}: LibraryItemRowProps) {
  const { t, i18n } = useTranslation("common");
  const navigate = useNavigate();
  const prefetchLibraryItem = usePrefetchLibraryItem();
  const p = libraryStatusPresentation(item.status);

  const sizeLabel = formatBytes(item.total_size_bytes);
  const addedLabel = formatDate(item.added_at, i18n.language);
  const lastGrabbed = item.last_grabbed_at
    ? formatDate(item.last_grabbed_at, i18n.language)
    : null;
  const digitalRelease =
    item.type === "movie" && item.digital_release_date
      ? formatDate(item.digital_release_date, i18n.language)
      : null;
  const resolutionLabel = formatResolution(item.resolution);
  const codecLabel = formatCodec(item.video_codec);
  const durationLabel = formatDuration(item.duration_secs);

  return (
    <div
      className="group flex items-stretch gap-3 rounded-xl border border-neutral-700 bg-neutral-800 px-3 py-2.5 cursor-pointer hover:bg-neutral-700/40 transition-colors"
      onClick={() =>
        navigate({
          to: "/library/$libraryId",
          params: { libraryId: String(item.id) },
        })
      }
      onMouseEnter={() => prefetchLibraryItem(item)}
      onTouchStart={() => prefetchLibraryItem(item)}
    >
      {/* Status accent bar */}
      <div
        className={cn(
          "shrink-0 w-0.5 self-stretch rounded-full",
          p.liseretClass,
        )}
      />

      {/* Mini poster */}
      <div className="relative shrink-0 w-12 aspect-[2/3] self-center rounded-lg overflow-hidden bg-neutral-800">
        <MiniPoster posterUrl={item.poster_url} />
      </div>

      {/* Main content */}
      <div className="flex-1 min-w-0 flex flex-col justify-center gap-1">
        {/* Title row */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-neutral-100 truncate">
            {item.title}
          </span>
          {item.year && (
            <span className="shrink-0 text-xs text-neutral-400">
              {item.year}
            </span>
          )}
          <span className="shrink-0 inline-flex items-center gap-1 text-[11px] text-neutral-400">
            {item.type === "movie" ? (
              <Film className="size-3" />
            ) : (
              <Tv className="size-3" />
            )}
            {item.type === "movie"
              ? t("medias.library.typeMovie")
              : t("medias.library.typeShow")}
          </span>
          {!item.monitored && (
            <span className="shrink-0 inline-flex items-center gap-0.5 text-[10px] text-neutral-400">
              <EyeOff className="size-3" />
              {t("medias.library.unmonitored")}
            </span>
          )}
        </div>

        {/* Overview */}
        {item.overview && (
          <p className="text-xs text-neutral-400 line-clamp-2 leading-relaxed">
            {item.overview}
          </p>
        )}

        {/* Meta pills */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {/* Status chip */}
          <span
            className={cn(
              "rounded-md px-1.5 py-0.5 text-[10px] font-semibold",
              p.badgeClass,
            )}
          >
            {t(p.labelKey)}
          </span>

          {item.needs_upgrade && (
            <span className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold bg-orange-500/20 text-orange-300">
              <ArrowUpCircle className="size-3" />
              {t("medias.library.needsUpgrade")}
            </span>
          )}

          {item.quality_profile?.name && (
            <span className="text-[11px] text-neutral-400 bg-neutral-700/50 rounded-md px-2 py-0.5">
              {item.quality_profile.name}
            </span>
          )}

          {sizeLabel && (
            <span className="text-[11px] text-neutral-400 bg-neutral-700/50 rounded-md px-2 py-0.5 tabular-nums">
              {sizeLabel}
            </span>
          )}

          {/* Resolution + HDR */}
          {resolutionLabel && (
            <span className="text-[11px] font-medium text-neutral-300 bg-neutral-700/50 rounded-md px-2 py-0.5 tabular-nums">
              {resolutionLabel}
              {item.hdr_format && (
                <span className="ml-1 text-amber-400">{item.hdr_format}</span>
              )}
            </span>
          )}

          {/* Codec */}
          {codecLabel && (
            <span className="text-[11px] text-neutral-400 bg-neutral-700/50 rounded-md px-2 py-0.5">
              {codecLabel}
            </span>
          )}

          {/* Audio */}
          {item.audio_format && (
            <span className="text-[11px] text-neutral-400 bg-neutral-700/50 rounded-md px-2 py-0.5">
              {item.audio_format}
            </span>
          )}

          {/* Duration (movies) */}
          {durationLabel && item.type === "movie" && (
            <span className="text-[11px] text-neutral-400 tabular-nums">
              {durationLabel}
            </span>
          )}

          {/* Season / episode progress (shows) */}
          {item.type === "show" &&
            item.episode_count != null &&
            item.episode_count > 0 && (
              <span className="text-[11px] text-neutral-400 bg-neutral-700/50 rounded-md px-2 py-0.5">
                {item.season_count != null && item.season_count > 1
                  ? `S${item.season_count} · `
                  : ""}
                {item.downloaded_episode_count ?? 0}/{item.episode_count} eps
              </span>
            )}

          {/* Language tags */}
          {item.language_tags.length > 0 && (
            <span className="text-[11px] text-neutral-400 tabular-nums">
              {item.language_tags
                .slice(0, 3)
                .map((l) => l.toUpperCase())
                .join(" · ")}
            </span>
          )}

          {item.affected_episodes != null && item.affected_episodes > 0 && (
            <span className="text-[11px] text-amber-400 bg-amber-500/10 rounded-md px-2 py-0.5">
              {t("medias.library.episodesMissing", {
                count: item.affected_episodes,
              })}
            </span>
          )}

          {digitalRelease && (
            <span className="text-[11px] text-neutral-400 tabular-nums">
              {t("medias.library.digitalRelease", { date: digitalRelease })}
            </span>
          )}

          {(lastGrabbed || addedLabel) && (
            <span className="text-[11px] text-neutral-400 tabular-nums">
              {lastGrabbed ?? addedLabel}
            </span>
          )}
        </div>
      </div>

      {/* Search now — shown for movies with quickAction="search" */}
      {item.type === "movie" && p.quickAction === "search" && onMovieSearch && (
        <div className="shrink-0 self-center">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onMovieSearch(item.id);
            }}
            disabled={movieSearchPending}
            className="flex items-center gap-1 rounded-lg bg-primary-600/90 hover:bg-primary-600 disabled:opacity-50 text-white text-xs font-medium px-2.5 py-1.5 transition-colors"
          >
            <Search size={11} />
            <span className="hidden sm:inline">
              {t("library.management.searchNow")}
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
