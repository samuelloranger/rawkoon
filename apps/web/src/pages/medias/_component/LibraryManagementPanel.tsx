import type { LibraryMedia } from "@rawkoon/shared/types";
import { LibraryQualityProfileSection } from "./LibraryQualityProfileSection";
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
}: LibraryManagementPanelProps) {
  return (
    <div className="py-4 space-y-3">
      <LibraryInfoOverridesSection libraryId={libraryId} item={item} />
      <LibraryQualityProfileSection
        libraryId={libraryId}
        onUpgradeManualSearch={onUpgradeManualSearch}
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
