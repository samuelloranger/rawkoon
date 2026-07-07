import { useTranslation } from "react-i18next";
import { Tv, Tag, ArrowDownUp } from "lucide-react";
import type { DiscoverFilters, SortOpt } from "./discoverTypes";
import { DISCOVER_LANGUAGE_FILTERS } from "./discoverConfig";
import { DiscoverFilterChip } from "./DiscoverFilterChip";
import {
  DiscoverGenrePicker,
  DiscoverServicePicker,
  DiscoverSortPicker,
} from "./DiscoverPickers";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export function DiscoverToolbar({
  mediaType,
  providerId,
  genreId,
  sortBy,
  originalLanguage,
  providers,
  genres,
  visibleSorts,
  activeProvider,
  activeGenre,
  activeSort,
  onMediaTypeChange,
  onProviderChange,
  onGenreChange,
  onSortChange,
  onLanguageToggle,
}: {
  mediaType: DiscoverFilters["mediaType"];
  providerId: number | null;
  genreId: number | null;
  sortBy: string;
  originalLanguage: string | null;
  providers: { id: number; name: string; logo_url: string }[];
  genres: { id: number; name: string }[];
  visibleSorts: SortOpt[];
  activeProvider: { id: number; name: string; logo_url: string } | null;
  activeGenre: { id: number; name: string } | null;
  activeSort: SortOpt | null;
  onMediaTypeChange: (type: "movie" | "tv") => void;
  onProviderChange: (id: number | null) => void;
  onGenreChange: (id: number | null) => void;
  onSortChange: (value: string) => void;
  onLanguageToggle: (code: string) => void;
}) {
  const { t } = useTranslation("common");

  return (
    <div className="flex w-full min-w-0 max-w-full flex-col gap-2 md:flex-row md:flex-wrap md:items-center">
      <Select
        value={mediaType}
        onValueChange={(value) => onMediaTypeChange(value as "movie" | "tv")}
      >
        <SelectTrigger className="h-9 w-full shrink-0 md:w-auto">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="movie">{t("medias.movie_plural")}</SelectItem>
          <SelectItem value="tv">{t("medias.series_plural")}</SelectItem>
        </SelectContent>
      </Select>

      <div className="flex w-full min-w-0 max-w-full flex-nowrap items-stretch gap-2 md:w-auto md:max-w-none md:flex-none">
        <div className="min-w-0 flex-1 basis-0 md:flex-none md:min-w-0">
          <DiscoverFilterChip
            icon={Tv}
            label={t("medias.discover.service", { defaultValue: "Service" })}
            value={
              activeProvider ? (
                <span className="flex min-w-0 items-center gap-1.5">
                  <img
                    src={activeProvider.logo_url}
                    alt=""
                    className="h-4 w-4 shrink-0 rounded-sm object-contain"
                  />
                  <span className="min-w-0 truncate">
                    {activeProvider.name}
                  </span>
                </span>
              ) : null
            }
            onClear={activeProvider ? () => onProviderChange(null) : undefined}
            popoverContent={(close) => (
              <DiscoverServicePicker
                providers={providers.slice(0, 18)}
                selectedId={providerId}
                onSelect={(id) => {
                  onProviderChange(id);
                  close();
                }}
                allLabel={t("medias.discover.allServices", {
                  defaultValue: "All services",
                })}
              />
            )}
          />
        </div>

        <div className="min-w-0 flex-1 basis-0 md:flex-none md:min-w-0">
          <DiscoverFilterChip
            icon={Tag}
            label={t("medias.discover.genre", { defaultValue: "Genre" })}
            value={activeGenre?.name ?? null}
            onClear={activeGenre ? () => onGenreChange(null) : undefined}
            popoverContent={(close) => (
              <DiscoverGenrePicker
                genres={genres}
                selectedId={genreId}
                onSelect={(id) => {
                  onGenreChange(id);
                  close();
                }}
                allLabel={t("medias.discover.allGenres", {
                  defaultValue: "All genres",
                })}
              />
            )}
          />
        </div>
      </div>

      <div
        className={cn(
          "flex min-w-0 max-w-full shrink-0 flex-nowrap items-center gap-2",
          "w-full basis-full justify-between",
          "md:ml-auto md:w-auto md:basis-auto md:max-w-none md:justify-start",
        )}
      >
        <div className="min-w-0 max-w-[min(100%,55vw)] md:max-w-none">
          <DiscoverFilterChip
            icon={ArrowDownUp}
            label={t("medias.discover.sort", { defaultValue: "Sort" })}
            value={activeSort ? t(activeSort.labelKey) : null}
            popoverContent={(close) => (
              <DiscoverSortPicker
                options={visibleSorts.map((s) => ({
                  value: s.value,
                  label: t(s.labelKey),
                }))}
                selected={sortBy}
                onSelect={(value) => {
                  onSortChange(value);
                  close();
                }}
              />
            )}
          />
        </div>

        <div
          className={cn(
            "flex shrink-0 items-center gap-1.5",
            "md:border-l md:pl-2 md:border-neutral-700",
          )}
        >
          <span className="shrink-0 text-[10px] font-medium uppercase tracking-widest text-neutral-500">
            {t("medias.discover.lang")}
          </span>
          {DISCOVER_LANGUAGE_FILTERS.map((lf) => {
            const active = originalLanguage === lf.code;
            return (
              <button
                key={lf.code}
                type="button"
                onClick={() => onLanguageToggle(lf.code)}
                className={[
                  "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                  active
                    ? "border-primary-500/60 bg-primary-500/15 text-primary-300"
                    : "border-neutral-700 bg-neutral-900 text-neutral-400 hover:border-neutral-600",
                ].join(" ")}
              >
                {lf.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
