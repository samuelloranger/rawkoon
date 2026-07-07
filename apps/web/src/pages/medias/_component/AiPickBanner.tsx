import { useState } from "react";
import { Sparkles, AlertTriangle, RefreshCcw, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { InteractiveReleaseItem } from "@rawkoon/shared/types";

interface AiPickBannerProps {
  isLoading: boolean;
  isError: boolean;
  release: InteractiveReleaseItem | null;
  reasoning: string | null;
  grabBusy: boolean;
  onGrab: (release: InteractiveReleaseItem) => void;
  onRetry: () => void;
  onDismiss: () => void;
}

export function AiPickBanner({
  isLoading,
  isError,
  release,
  reasoning,
  grabBusy,
  onGrab,
  onRetry,
  onDismiss,
}: AiPickBannerProps) {
  const [grabbed, setGrabbed] = useState(false);

  if (!isLoading && !isError && !release) return null;

  const handleGrab = (r: InteractiveReleaseItem) => {
    onGrab(r);
    setGrabbed(true);
    setTimeout(() => onDismiss(), 1800);
  };

  return (
    <div
      className={cn(
        "mb-3 rounded-xl border px-4 py-3 text-sm",
        isError
          ? "border-red-800/40 bg-red-950/20"
          : "border-violet-700/40 bg-violet-950/20",
      )}
    >
      {isLoading && (
        <div className="flex items-center gap-2 text-violet-400">
          <Sparkles className="h-3.5 w-3.5 shrink-0 animate-pulse" />
          <span className="text-xs animate-pulse text-neutral-400">
            AI is picking the best release…
          </span>
        </div>
      )}

      {isError && (
        <div className="flex items-center justify-between gap-2 text-red-400">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span className="text-xs">Could not get a response from AI</span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 text-xs"
            onClick={onRetry}
          >
            <RefreshCcw className="h-3 w-3" />
            Retry
          </Button>
        </div>
      )}

      {!isLoading && !isError && release && (
        <>
          {grabbed ? (
            <div className="flex items-center gap-2 text-green-400">
              <Check className="h-3.5 w-3.5 shrink-0" />
              <span className="text-xs font-medium">Grabbed!</span>
            </div>
          ) : (
            <div className="flex min-w-0 items-start gap-2">
              <Sparkles className="mt-px h-3.5 w-3.5 shrink-0 text-violet-500" />
              <div className="min-w-0 flex-1 space-y-1">
                <p className="text-xs font-semibold text-violet-300">AI Pick</p>
                <p className="break-words text-xs leading-snug text-neutral-300">
                  {release.title}
                </p>
                {reasoning && (
                  <p className="text-xs italic leading-snug text-neutral-400">
                    {reasoning}
                  </p>
                )}
                <div className="flex items-center justify-end gap-1.5 pt-1">
                  <Button
                    size="sm"
                    className="h-7 gap-1 bg-violet-600 text-xs text-white hover:bg-violet-700"
                    disabled={grabBusy}
                    onClick={() => handleGrab(release)}
                  >
                    <Sparkles className="h-3 w-3" />
                    Grab
                  </Button>
                  <button
                    type="button"
                    onClick={onDismiss}
                    className="flex h-7 w-7 items-center justify-center rounded-md text-neutral-400 transition-colors hover:bg-violet-900/30 hover:text-neutral-300"
                    aria-label="Dismiss"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
