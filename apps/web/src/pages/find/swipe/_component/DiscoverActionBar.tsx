import { Bookmark, Plus, RotateCcw, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  AddOnlyMenu,
  AddSearchCaption,
} from "@/features/medias/components/AddSearchControls";
import { cn } from "@/lib/utils";

interface Props {
  disabled: boolean;
  canUndo: boolean;
  onDismiss: () => void;
  onWatchlist: () => void;
  /** Admin setting: Add also searches for a release. */
  searchOnAdd: boolean;
  /** Non-admins file a request instead of adding to the library. */
  requestMode?: boolean;
  onAdd: () => void;
  onAddOnly: () => void;
  onUndo: () => void;
}

const btn =
  "focus-ring flex items-center justify-center rounded-full transition-transform active:scale-90 disabled:opacity-40 /60";

export function DiscoverActionBar({
  disabled,
  canUndo,
  onDismiss,
  onWatchlist,
  searchOnAdd,
  requestMode = false,
  onAdd,
  onAddOnly,
  onUndo,
}: Props) {
  const { t } = useTranslation("common");
  return (
    <div className="mt-5">
      <div className="flex items-center justify-center gap-5">
        <button
          type="button"
          aria-label={t("medias.discover.notInterested")}
          disabled={disabled}
          onClick={onDismiss}
          className={cn(
            btn,
            "h-14 w-14 border border-rose-500/40 bg-neutral-800 text-rose-400",
          )}
        >
          <X className="h-6 w-6" />
        </button>
        <button
          type="button"
          aria-label={t("medias.discover.addToWatchlist")}
          disabled={disabled}
          onClick={onWatchlist}
          className={cn(
            btn,
            "h-12 w-12 border border-emerald-500/40 bg-neutral-800 text-emerald-400",
          )}
        >
          <Bookmark className="h-5 w-5" />
        </button>
        <button
          type="button"
          aria-label={
            requestMode
              ? t("requests.request")
              : t("medias.discover.addToLibrary")
          }
          disabled={disabled}
          onClick={onAdd}
          className={cn(
            btn,
            "h-14 w-14 bg-primary-500 text-neutral-950 shadow-lg shadow-primary-900/40",
          )}
        >
          <Plus className="h-6 w-6" />
        </button>
        <button
          type="button"
          aria-label={t("medias.discover.undoLastAction")}
          disabled={!canUndo}
          onClick={onUndo}
          className={cn(
            btn,
            "h-12 w-12 border border-white/10 bg-neutral-800 text-neutral-300",
          )}
        >
          <RotateCcw className="h-5 w-5" />
        </button>
      </div>
      {searchOnAdd && (
        <div className="mt-2 flex items-center justify-center gap-0.5">
          <AddSearchCaption />
          <AddOnlyMenu
            onAddOnly={onAddOnly}
            disabled={disabled}
            className="h-6 w-6 rounded-full text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
          />
        </div>
      )}
    </div>
  );
}
