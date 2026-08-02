import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Languages } from "lucide-react";
import type { LibraryMedia, TitleTranslation } from "@rawkoon/shared/types";
import { useUpdateLibrarySearchTitle } from "@/features/medias/hooks/useUpdateLibrarySearchTitle";
import { buildTitleOptions } from "@/lib/utils/interactive-search";
import { languageDisplayName } from "@/lib/utils/languageDisplayName";
import { ManagementSection } from "./LibrarySharedUI";

const LIBRARY_TITLE_LANGUAGE = "en";

interface LibrarySearchTitleSectionProps {
  libraryId: number;
  item: LibraryMedia;
  tmdbOriginalTitle: string | null;
  tmdbOriginalLanguage: string | null;
  tmdbTitleTranslations: TitleTranslation[];
  tmdbPending?: boolean;
}

export function LibrarySearchTitleSection({
  libraryId,
  item,
  tmdbOriginalTitle,
  tmdbOriginalLanguage,
  tmdbTitleTranslations,
  tmdbPending = false,
}: LibrarySearchTitleSectionProps) {
  const { t, i18n } = useTranslation("common");
  const updateSearchTitle = useUpdateLibrarySearchTitle();

  const options = useMemo(() => {
    const originalTag = t("medias.interactive.originalTag", "original");
    return buildTitleOptions({
      localized: item.title,
      localizedLanguage: LIBRARY_TITLE_LANGUAGE,
      original: tmdbOriginalTitle,
      originalLanguage: tmdbOriginalLanguage,
      translations: tmdbTitleTranslations,
    }).map((option) => {
      const name = languageDisplayName(option.languageCode, i18n.language);
      return {
        ...option,
        label: option.isOriginal ? `${name} (${originalTag})` : name,
      };
    });
  }, [
    item.title,
    tmdbOriginalTitle,
    tmdbOriginalLanguage,
    tmdbTitleTranslations,
    i18n.language,
    t,
  ]);

  const selectedQuery = useMemo(() => {
    const persisted = item.search_title?.trim();
    if (persisted) {
      const match = options.find(
        (o) => o.query.toLocaleLowerCase() === persisted.toLocaleLowerCase(),
      );
      if (match) return match.query;
    }
    return options[0]?.query ?? "";
  }, [item.search_title, options]);

  const disabled =
    updateSearchTitle.isPending || tmdbPending || options.length === 0;

  return (
    <ManagementSection
      icon={Languages}
      title={t("library.management.searchTitle", "Search title")}
    >
      {options.length === 0 ? (
        <p className="text-xs text-neutral-500">
          {item.title}
          {tmdbPending
            ? ` — ${t("library.management.searchTitleLoading", "Loading titles…")}`
            : ` — ${t(
                "library.management.searchTitleUnavailable",
                "TMDB titles unavailable",
              )}`}
        </p>
      ) : (
        <select
          aria-label={t("library.management.searchTitle", "Search title")}
          value={selectedQuery}
          disabled={disabled}
          onChange={(e) => {
            const query = e.target.value;
            const option = options.find((o) => o.query === query);
            if (!option) return;
            void updateSearchTitle
              .mutateAsync({
                id: libraryId,
                body: {
                  search_title_language: option.languageCode,
                  search_title: option.query,
                },
              })
              .then(() => {
                toast.success(
                  t(
                    "library.management.searchTitleUpdated",
                    "Search title updated",
                  ),
                );
              })
              .catch(() => {
                toast.error(
                  t(
                    "library.management.searchTitleUpdateFailed",
                    "Failed to update search title",
                  ),
                );
              });
          }}
          className="focus-ring w-full rounded-lg border border-border bg-neutral-800/80 px-2.5 py-1.5 text-xs text-neutral-100 disabled:opacity-60"
        >
          {options.map((option) => (
            <option key={option.query} value={option.query}>
              {option.label} — {option.query}
            </option>
          ))}
        </select>
      )}
    </ManagementSection>
  );
}
