import { useTranslation } from "react-i18next";
import { useSimilarMedias } from "@/features/medias/hooks/useSimilarMedias";
import { ExploreCard } from "@/pages/medias/_component/ExploreCard";

interface SimilarMediasPanelProps {
  isActive: boolean;
  tmdbId: number | null;
  mediaType: "movie" | "tv" | null;
  onAdded?: () => void;
}

export function SimilarMediasPanel({
  isActive,
  tmdbId,
  mediaType,
  onAdded,
}: SimilarMediasPanelProps) {
  const { t, i18n } = useTranslation("common");
  const { data, isLoading } = useSimilarMedias(
    tmdbId,
    mediaType,
    i18n.language,
    { enabled: isActive },
  );

  const items = data?.items ?? [];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary-600 border-t-transparent" />
          <p className="text-sm text-neutral-400">{t("common.loading")}</p>
        </div>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <p className="text-center text-sm text-neutral-400 py-12">
        {t("medias.similar.empty")}
      </p>
    );
  }

  return (
    <div className="grid grid-cols-3 sm:grid-cols-4 gap-3 py-1">
      {items.map((item) => (
        <ExploreCard key={item.id} item={item} onAdded={onAdded} />
      ))}
    </div>
  );
}
