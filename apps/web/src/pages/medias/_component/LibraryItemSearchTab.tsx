import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type {
  LibraryMedia,
  MediaItem,
  TitleTranslation,
} from "@rawkoon/shared/types";
import {
  buildTitleOptions,
  type LabeledTitleOption,
} from "@/lib/utils/interactive-search";
import { languageDisplayName } from "@/lib/utils/languageDisplayName";
import { InteractiveSearchPanel } from "./InteractiveSearchPanel";

function libraryToMediaItem(item: LibraryMedia): MediaItem {
  return {
    id: String(item.id),
    media_type: item.type === "show" ? "series" : "movie",
    source_id: null,
    title: item.title,
    sort_title: null,
    year: item.year,
    status: item.status,
    monitored: true,
    downloaded: item.status === "downloaded",
    downloading: item.status === "downloading",
    added_at: item.added_at,
    tmdb_id: item.tmdb_id,
    imdb_id: null,
    tvdb_id: null,
    season_count: null,
    episode_count: null,
    poster_url: item.poster_url,
    release_tags: null,
  };
}

export type EpisodeSearchCtx = {
  id: number;
  season: number;
  episode: number;
  title: string | null;
};

type Props = {
  item: LibraryMedia;
  episodeSearchCtx: EpisodeSearchCtx | null;
  seasonSearchCtx: number | null;
  onClearEpisodeCtx: () => void;
  onClearSeasonCtx: () => void;
  /** From TMDB details — original-language title (movies + TV) */
  tmdbOriginalTitle: string | null;
  /** ISO 639-1 code of the original language (movies + TV) */
  tmdbOriginalLanguage: string | null;
  /** From TMDB translations — one title per language for the search picker */
  tmdbTitleTranslations: TitleTranslation[];
  /** When true, grabs are marked as upgrades */
  isUpgradeMode?: boolean;
  onClearUpgradeMode?: () => void;
};

export function LibraryItemSearchTab({
  item,
  episodeSearchCtx,
  seasonSearchCtx,
  onClearEpisodeCtx,
  onClearSeasonCtx,
  tmdbOriginalTitle,
  tmdbOriginalLanguage,
  tmdbTitleTranslations,
  isUpgradeMode = false,
  onClearUpgradeMode,
}: Props) {
  const mediaItem = libraryToMediaItem(item);
  const { t, i18n } = useTranslation("common");

  const seasonSuffix =
    !episodeSearchCtx && seasonSearchCtx !== null
      ? ` S${String(seasonSearchCtx).padStart(2, "0")}`
      : "";

  const epSuffix = episodeSearchCtx
    ? ` S${String(episodeSearchCtx.season).padStart(2, "0")}E${String(episodeSearchCtx.episode).padStart(2, "0")}`
    : "";

  const ctxSuffix = epSuffix || seasonSuffix;

  const localizedQuery = `${item.title}${ctxSuffix}`;

  // Build the per-language title options for the search picker. The platform's
  // own title is the default; EN/FR are pinned, then the original language, then
  // a few common languages — letting the user search private trackers by
  // whichever localized title they use.
  const platformLanguage = (i18n.language || "en").split("-")[0].toLowerCase();
  const titleOptions = useMemo<LabeledTitleOption[]>(() => {
    const originalTag = t("medias.interactive.originalTag", "original");
    return buildTitleOptions({
      localized: item.title,
      platformLanguage,
      original: tmdbOriginalTitle,
      originalLanguage: tmdbOriginalLanguage,
      translations: tmdbTitleTranslations,
      suffix: ctxSuffix,
    }).map((option) => {
      const name = languageDisplayName(option.languageCode, i18n.language);
      return {
        ...option,
        label: option.isOriginal ? `${name} (${originalTag})` : name,
      };
    });
  }, [
    item.title,
    platformLanguage,
    tmdbOriginalTitle,
    tmdbOriginalLanguage,
    tmdbTitleTranslations,
    ctxSuffix,
    i18n.language,
    t,
  ]);

  return (
    <>
      {episodeSearchCtx && (
        <div className="mb-3 flex items-center justify-between rounded-lg border border-primary-800 bg-primary-950/30 px-3 py-2">
          <span className="text-xs font-medium text-primary-300">
            {t("medias.detail.searchingEpisode", "Searching for")} S
            {String(episodeSearchCtx.season).padStart(2, "0")}E
            {String(episodeSearchCtx.episode).padStart(2, "0")}
            {episodeSearchCtx.title ? ` — ${episodeSearchCtx.title}` : ""}
          </span>
          <button
            type="button"
            onClick={onClearEpisodeCtx}
            className="text-xs text-primary-500 hover:text-primary-300"
          >
            {t("common.clear", "Clear")}
          </button>
        </div>
      )}
      {seasonSearchCtx !== null && !episodeSearchCtx && (
        <div className="mb-3 flex items-center justify-between rounded-lg border border-violet-800 bg-violet-950/30 px-3 py-2">
          <span className="text-xs font-medium text-violet-300">
            {t("medias.detail.searchingSeasonPack", "Searching season pack")} S
            {String(seasonSearchCtx).padStart(2, "0")}
          </span>
          <button
            type="button"
            onClick={onClearSeasonCtx}
            className="text-xs text-violet-500 hover:text-violet-300"
          >
            {t("common.clear", "Clear")}
          </button>
        </div>
      )}
      {isUpgradeMode && (
        <div className="mb-3 flex items-center justify-between rounded-lg border border-amber-800 bg-amber-950/30 px-3 py-2">
          <span className="text-xs font-medium text-amber-300">
            {t(
              "medias.detail.upgradeMode",
              "Upgrade mode — grab will replace the existing file",
            )}
          </span>
          <button
            type="button"
            onClick={onClearUpgradeMode}
            className="text-xs text-amber-500 hover:text-amber-300"
          >
            {t("common.clear", "Clear")}
          </button>
        </div>
      )}
      <InteractiveSearchPanel
        isActive
        media={mediaItem}
        libraryMediaId={item.id}
        defaultSearchQuery={localizedQuery}
        titleOptions={titleOptions}
        episodeId={episodeSearchCtx?.id ?? null}
        defaultSeason={seasonSearchCtx}
        isUpgradeMode={isUpgradeMode}
      />
    </>
  );
}
