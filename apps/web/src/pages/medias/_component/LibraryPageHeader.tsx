import { Plus, RefreshCw, Download } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

interface LibraryPageHeaderProps {
  movieCount: number;
  showCount: number;
  isLoading: boolean;
  onRefresh: () => void;
  onAddClick: () => void;
  isAdmin: boolean;
}

export function LibraryPageHeader({
  movieCount,
  showCount,
  isLoading,
  onRefresh,
  onAddClick,
  isAdmin,
}: LibraryPageHeaderProps) {
  const { t } = useTranslation("common");
  const navigate = useNavigate();

  return (
    <div className="flex flex-col gap-4 pb-1 sm:flex-row sm:items-end sm:justify-between">
      {/* Title + count readout */}
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-semibold leading-none tracking-tight text-neutral-50 sm:text-3xl">
          {t("medias.library.pageTitle")}
        </h1>
        <p className="text-sm text-neutral-400">
          <span>
            {t("medias.library.moviesWithCount", { count: movieCount })}
          </span>
          <span className="mx-1.5 select-none text-neutral-600">·</span>
          <span>
            {t("medias.library.showsWithCount", { count: showCount })}
          </span>
        </p>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        {/* Primary Add action — admin only */}
        {isAdmin && (
          <button
            type="button"
            onClick={onAddClick}
            className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary-600 px-4 text-sm font-medium text-neutral-950 transition-colors hover:bg-primary-500 sm:flex-none"
          >
            <Plus size={15} />
            {t("medias.detail.addToLibrary")}
          </button>
        )}

        {/* Downloads import — admin only */}
        {isAdmin && (
          <button
            type="button"
            onClick={() => navigate({ to: "/library/downloads" })}
            className="flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-neutral-700 bg-neutral-800/60 px-3 text-sm font-medium text-neutral-300 transition-colors hover:bg-neutral-700/70 hover:text-neutral-100"
          >
            <Download size={14} />
            <span className="hidden sm:inline">
              {t("medias.library.downloadsImport")}
            </span>
          </button>
        )}

        {/* Refresh — calm secondary icon button */}
        <button
          type="button"
          onClick={onRefresh}
          title={t("medias.library.pageTitle")}
          disabled={isLoading}
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-neutral-700 bg-neutral-800/60 text-neutral-400 transition-colors hover:text-neutral-100",
            isLoading && "animate-spin pointer-events-none text-neutral-600",
          )}
        >
          <RefreshCw size={14} />
        </button>
      </div>
    </div>
  );
}
