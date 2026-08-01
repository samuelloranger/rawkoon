import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { TmdbMediaSearchPanel } from "@/pages/medias/_component/TmdbMediaSearchPanel";

interface TmdbSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  /**
   * Pass a ref owned by the caller when focus() must be called synchronously
   * within the user-gesture stack (required on iOS/Android to open the keyboard).
   */
  inputRef?: React.RefObject<HTMLInputElement | null>;
}

export function TmdbSearchModal({
  isOpen,
  onClose,
  inputRef: externalInputRef,
}: TmdbSearchModalProps) {
  const { t } = useTranslation("common");
  const internalRef = useRef<HTMLInputElement>(null);
  const inputRef = externalInputRef ?? internalRef;
  const titleId = useId();
  const containerRef = useRef<HTMLDivElement>(null);

  // The modal stays mounted when closed, so Escape is the only keyboard exit.
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // A result can open ExploreCardDetailDialog on top of this one. Radix
      // portals it to <body> and dismisses it on Escape without marking the
      // event handled, so without this check one keypress would close both and
      // drop the user out of their search entirely.
      const topmost = document.querySelector<HTMLElement>(
        '[role="dialog"][data-state="open"]',
      );
      if (topmost && !containerRef.current?.contains(topmost)) return;
      onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  return createPortal(
    <div
      ref={containerRef}
      className={cn(
        "fixed inset-0 z-[var(--z-modal)] transition-opacity duration-200",
        isOpen
          ? "opacity-100 pointer-events-auto"
          : "opacity-0 pointer-events-none",
      )}
      aria-hidden={!isOpen}
      // Without this the closed panel keeps its controls in the tab order,
      // so keyboard users tab through an invisible dialog.
      inert={!isOpen}
    >
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn(
          "absolute inset-0 flex flex-col bg-neutral-950 transition-transform duration-200",
          isOpen ? "translate-y-0" : "-translate-y-1",
        )}
      >
        <div className="shrink-0 flex items-start justify-between px-5 pt-[calc(0.875rem+env(safe-area-inset-top,0px))] pb-3.5 border-b border-neutral-800">
          <div>
            <p id={titleId} className="text-sm font-semibold text-neutral-50">
              {t("medias.tmdb.title")}
            </p>
            <p className="text-xs text-neutral-400 mt-0.5">
              {t("medias.tmdb.subtitle")}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="focus-ring ml-3 mt-0.5 shrink-0 rounded-full p-1.5 text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-200"
          >
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto overscroll-contain p-4 pb-[max(1rem,env(safe-area-inset-bottom,0px))]">
          <TmdbMediaSearchPanel inputRef={inputRef} variant="modal" />
        </div>
      </div>
    </div>,
    document.body,
  );
}
