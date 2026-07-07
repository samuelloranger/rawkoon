import { useTranslation } from "react-i18next";
import { Dialog } from "@/components/dialog";
import { Button } from "@/components/ui/button";

interface LibraryUpgradeModalProps {
  open: boolean;
  mediaType: "movie" | "show";
  affectedEpisodes?: number;
  onAutoSearch: () => void;
  onManualSearch: () => void;
  onDismiss: () => void;
  isLoading?: boolean;
}

export function LibraryUpgradeModal({
  open,
  mediaType,
  affectedEpisodes,
  onAutoSearch,
  onManualSearch,
  onDismiss,
  isLoading,
}: LibraryUpgradeModalProps) {
  const { t } = useTranslation("common");

  const description =
    mediaType === "movie"
      ? t("medias.library.upgradeModal.movieDescription")
      : t("medias.library.upgradeModal.showDescription", {
          count: affectedEpisodes ?? 0,
        });

  return (
    <Dialog
      isOpen={open}
      onClose={onDismiss}
      title={t("medias.library.upgradeModal.title")}
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-neutral-400">{description}</p>

        {mediaType === "show" && (
          <p className="text-xs text-neutral-500">
            {t("medias.library.upgradeModal.showManualNote")}
          </p>
        )}

        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button variant="default" onClick={onAutoSearch} disabled={isLoading}>
            {t("medias.library.upgradeModal.autoSearch")}
          </Button>
          <Button
            variant="outline"
            onClick={onManualSearch}
            disabled={isLoading}
          >
            {t("medias.library.upgradeModal.manualSearch")}
          </Button>
          <Button variant="ghost" onClick={onDismiss} disabled={isLoading}>
            {t("medias.library.upgradeModal.keepCurrent")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
