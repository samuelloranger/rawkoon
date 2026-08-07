import type { LibraryMedia, TitleTranslation } from "@rawkoon/shared/types";
import { LibraryQualityProfileSection } from "./LibraryQualityProfileSection";
import { LibrarySearchTitleSection } from "./LibrarySearchTitleSection";
import { LibraryMediaSection } from "./LibraryMediaSection";
import { LibraryDownloadHistorySection } from "./LibraryDownloadHistorySection";
import { LibraryActionsSection } from "./LibraryActionsSection";
import { LibraryInfoOverridesSection } from "./LibraryInfoOverridesSection";

interface LibraryManagementPanelProps {
  libraryId: number;
  item: LibraryMedia;
  itemStatus?: string;
  itemMonitored?: boolean;
  onDeleted?: () => void;
  onSearchEpisode?: (ep: {
    id: number;
    season: number;
    episode: number;
    title: string | null;
  }) => void;
  onSearchSeason?: (season: number) => void;
  onUpgradeManualSearch?: () => void;
  tmdbOriginalTitle?: string | null;
  tmdbOriginalLanguage?: string | null;
  tmdbTitleTranslations?: TitleTranslation[];
  tmdbPending?: boolean;
}

export function LibraryManagementPanel({
  libraryId,
  item,
  itemStatus,
  itemMonitored,
  onDeleted,
  onSearchEpisode,
  onSearchSeason,
  onUpgradeManualSearch,
  tmdbOriginalTitle = null,
  tmdbOriginalLanguage = null,
  tmdbTitleTranslations = [],
  tmdbPending = false,
}: LibraryManagementPanelProps) {
  return (
    <div className="py-4 space-y-3">
      <LibraryInfoOverridesSection libraryId={libraryId} item={item} />
      <LibraryQualityProfileSection
        libraryId={libraryId}
        item={item}
        onUpgradeManualSearch={onUpgradeManualSearch}
      />
      <LibrarySearchTitleSection
        libraryId={libraryId}
        item={item}
        tmdbOriginalTitle={tmdbOriginalTitle}
        tmdbOriginalLanguage={tmdbOriginalLanguage}
        tmdbTitleTranslations={tmdbTitleTranslations}
        tmdbPending={tmdbPending}
      />
      <LibraryMediaSection
        libraryId={libraryId}
        onSearchEpisode={onSearchEpisode}
        onSearchSeason={onSearchSeason}
      />
      <LibraryDownloadHistorySection libraryId={libraryId} />
      <LibraryActionsSection
        libraryId={libraryId}
        itemStatus={itemStatus}
        itemMonitored={itemMonitored}
        onDeleted={onDeleted}
      />
    </div>
  );
}
