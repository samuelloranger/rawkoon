import { Bookmark, Plus, RotateCcw, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  disabled: boolean;
  canUndo: boolean;
  onDismiss: () => void;
  onWatchlist: () => void;
  onAdd: () => void;
  onUndo: () => void;
}

const btn =
  "flex items-center justify-center rounded-full transition-transform active:scale-90 disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400/60";

export function DiscoverActionBar({
  disabled,
  canUndo,
  onDismiss,
  onWatchlist,
  onAdd,
  onUndo,
}: Props) {
  return (
    <div className="mt-5 flex items-center justify-center gap-5">
      <button
        type="button"
        aria-label="Not interested"
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
        aria-label="Add to watchlist"
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
        aria-label="Add to library"
        disabled={disabled}
        onClick={onAdd}
        className={cn(
          btn,
          "h-14 w-14 bg-primary-500 text-white shadow-lg shadow-primary-900/40",
        )}
      >
        <Plus className="h-6 w-6" />
      </button>
      <button
        type="button"
        aria-label="Undo last action"
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
  );
}
