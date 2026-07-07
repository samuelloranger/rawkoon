import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Search, SlidersHorizontal } from "lucide-react";
import { useLibrary } from "@/features/medias/hooks/useLibrary";
import { useUpdateLibraryQualityProfile } from "@/features/medias/hooks/useUpdateLibraryQualityProfile";
import { useSearchLibraryMovie } from "@/features/medias/hooks/useSearchLibraryMovie";
import { useUpgradeLibraryMedia } from "@/features/medias/hooks/useUpgradeLibraryMedia";
import { useQualityProfilesList } from "@/pages/settings/useQualityProfiles";
import { Button } from "@/components/ui/button";
import { ManagementSection } from "./LibrarySharedUI";
import { LibraryUpgradeModal } from "./LibraryUpgradeModal";

interface LibraryQualityProfileSectionProps {
  libraryId: number;
  onUpgradeManualSearch?: () => void;
}

export function LibraryQualityProfileSection({
  libraryId,
  onUpgradeManualSearch,
}: LibraryQualityProfileSectionProps) {
  const { t } = useTranslation("common");
  const { data: libList } = useLibrary(undefined, { staleTime: 0, gcTime: 0 });
  const { data: profilesData } = useQualityProfilesList({
    staleTime: 0,
    gcTime: 0,
  });
  const updateProfile = useUpdateLibraryQualityProfile();
  const searchMovieMut = useSearchLibraryMovie();
  const upgradeMedia = useUpgradeLibraryMedia();

  const [upgradeModalOpen, setUpgradeModalOpen] = useState(false);
  const [upgradeEpisodes, setUpgradeEpisodes] = useState<number | undefined>();

  const mediaRow = useMemo(
    () => libList?.items.find((i) => i.id === libraryId),
    [libList?.items, libraryId],
  );

  const profiles = profilesData?.profiles ?? [];

  const handleAutoSearch = async () => {
    try {
      await upgradeMedia.mutateAsync({ id: libraryId, mode: "auto" });
      toast.success(t("medias.library.upgradeModal.autoSearchStarted"));
    } catch {
      toast.error(t("medias.library.upgradeModal.autoSearchFailed"));
    } finally {
      setUpgradeModalOpen(false);
    }
  };

  const handleManualSearch = () => {
    setUpgradeModalOpen(false);
    onUpgradeManualSearch?.();
  };

  const searchNowButton =
    mediaRow?.type === "movie" && mediaRow.status === "wanted" ? (
      <Button
        type="button"
        size="sm"
        onClick={() => {
          void searchMovieMut
            .mutateAsync({ id: libraryId })
            .then((r) => {
              if (r.grabbed) toast.success(t("library.management.grabbed"));
              else toast.error(r.reason ?? t("library.management.grabFailed"));
            })
            .catch(() => toast.error(t("library.management.grabFailed")));
        }}
        disabled={searchMovieMut.isPending}
        className="gap-1.5 shrink-0"
      >
        <Search size={10} />
        {t("library.management.searchNow")}
      </Button>
    ) : undefined;

  return (
    <>
      <ManagementSection
        icon={SlidersHorizontal}
        title={t("library.management.qualityProfile")}
        right={searchNowButton}
      >
        <select
          value={mediaRow?.quality_profile_id ?? ""}
          onChange={(e) => {
            const v = e.target.value;
            const qid = v === "" ? null : parseInt(v, 10);
            void updateProfile
              .mutateAsync({
                id: libraryId,
                body: { quality_profile_id: qid },
              })
              .then((result) => {
                if (result.item.needs_upgrade) {
                  setUpgradeEpisodes(result.item.affected_episodes);
                  setUpgradeModalOpen(true);
                } else {
                  toast.success(t("library.management.qualityProfileUpdated"));
                }
              })
              .catch(() => {
                toast.error(t("library.management.qualityProfileUpdateFailed"));
              });
          }}
          disabled={updateProfile.isPending || !mediaRow}
          className="w-full rounded-lg border border-border bg-neutral-800/80 px-2.5 py-1.5 text-xs text-neutral-100 disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-primary-500/30"
        >
          <option value="">{t("library.management.qualityProfileNone")}</option>
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </ManagementSection>

      <LibraryUpgradeModal
        open={upgradeModalOpen}
        mediaType={mediaRow?.type ?? "movie"}
        affectedEpisodes={upgradeEpisodes}
        onAutoSearch={() => void handleAutoSearch()}
        onManualSearch={handleManualSearch}
        onDismiss={() => setUpgradeModalOpen(false)}
        isLoading={upgradeMedia.isPending}
      />
    </>
  );
}
